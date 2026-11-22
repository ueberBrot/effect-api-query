import { hashKey } from "@tanstack/query-core";
import type { DehydratedState, QueryKey } from "@tanstack/query-core";
import { Array as EffectArray, Effect, Order, Predicate, Schema } from "effect";

import type { InferQueryData, SupportedQueryView } from "./inference";
import { viewPrefix } from "./view-prefix";

type PrimitiveHashSegment = string | number | boolean;

const isPrimitiveHashSegment = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown
): value is PrimitiveHashSegment =>
  Predicate.isString(value) ||
  Predicate.isBoolean(value) ||
  (Predicate.isNumber(value) && Number.isFinite(value));

const hasPrimitiveSegment = (
  segments: ReadonlySet<PrimitiveHashSegment>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters
  value: unknown
): boolean => isPrimitiveHashSegment(value) && segments.has(value);

/** One generated leaf/view's cache-data codec, before observer selection. */
export interface HydrationCodec<
  Data,
  Encoded,
  DecodingServices = never,
  EncodingServices = never,
> {
  readonly prefix: QueryKey;
  readonly schema: Schema.Codec<
    Data,
    Encoded,
    DecodingServices,
    EncodingServices
  >;
  readonly matches: (key: QueryKey) => boolean;
}

const makeCodec = <S extends Schema.Codec<unknown, unknown, unknown, unknown>>(
  prefix: QueryKey,
  schema: S
) => {
  const hash = hashKey(prefix);
  const prefixLength = prefix.length;
  const lastIndex = prefixLength - 1;
  const lastSegment = prefix[lastIndex];
  const checkLast = isPrimitiveHashSegment(lastSegment);
  const firstSegment = prefixLength > 1 ? prefix[0] : undefined;
  const checkFirst = isPrimitiveHashSegment(firstSegment);
  return Object.freeze({
    prefix,
    schema,
    matches: (key: QueryKey) => {
      if (key.length < prefixLength) {
        return false;
      }
      if (checkLast && key[lastIndex] !== lastSegment) {
        return false;
      }
      if (checkFirst && key[0] !== firstSegment) {
        return false;
      }
      return hashKey(key.slice(0, prefixLength)) === hash;
    },
  });
};

/** Registers a codec whose decoded type matches the generated cached representation. */
export const queryViewCodec = <
  L extends { readonly key: () => QueryKey },
  V extends Exclude<SupportedQueryView<L>, "infinite">,
  S extends Schema.Codec<unknown, unknown, unknown, unknown>,
>(
  leaf: L,
  view: V,
  schema: S &
    ([S["Type"]] extends [InferQueryData<NoInfer<L>, NoInfer<V>>]
      ? [InferQueryData<NoInfer<L>, NoInfer<V>>] extends [S["Type"]]
        ? unknown
        : never
      : never)
): HydrationCodec<
  S["Type"],
  S["Encoded"],
  S["DecodingServices"],
  S["EncodingServices"]
> => makeCodec(viewPrefix(leaf, view), schema);

/** Infinite data needs an explicit page-parameter codec in addition to its page codec. */
export const infiniteQueryCodec = <
  L extends { readonly key: () => QueryKey },
  Page extends Schema.Codec<unknown, unknown, unknown, unknown>,
  PageParam extends Schema.Codec<unknown, unknown, unknown, unknown>,
>(
  leaf: L & ("infinite" extends SupportedQueryView<L> ? unknown : never),
  codecs: {
    readonly page: Page &
      ([Page["Type"]] extends [
        InferQueryData<NoInfer<L>, Extract<"query", SupportedQueryView<L>>>,
      ]
        ? [
            InferQueryData<NoInfer<L>, Extract<"query", SupportedQueryView<L>>>,
          ] extends [Page["Type"]]
          ? unknown
          : never
        : never);
    readonly pageParam: PageParam;
  }
) =>
  makeCodec(
    Object.freeze([...leaf.key(), "infinite"]),
    Schema.Struct({
      pages: Schema.Array(codecs.page),
      pageParams: Schema.Array(codecs.pageParam),
    })
  );

/** Native synchronous callbacks for a single service-free leaf/view snapshot. */
export const hydrationCallbacks = <Data, Encoded>(
  codec: HydrationCodec<Data, Encoded>
) => ({
  serializeData: Schema.encodeUnknownSync(codec.schema),
  deserializeData: Schema.decodeUnknownSync(codec.schema),
});

export class HydrationCodecError extends Error {
  readonly _tag = "HydrationCodecError";
  readonly code: "DuplicateCodec" | "UnknownQuery" | "UnsettledQuery";

  constructor(code: HydrationCodecError["code"]) {
    super(
      {
        DuplicateCodec:
          "A hydration codec is already registered for this leaf and view",
        UnknownQuery: "No hydration codec is registered for this query",
        UnsettledQuery:
          "Hydration codecs require successful queries without pending promises",
      }[code]
    );
    this.name = "HydrationCodecError";
    this.code = code;
  }
}

type Queries = DehydratedState["queries"];

/** Prepares all query data before the application calls native hydrate or serializes a snapshot. */
export interface HydrationRegistry<
  DecodingServices = never,
  EncodingServices = never,
> {
  readonly matches: (key: QueryKey) => boolean;
  readonly encodeQueries: (
    queries: DehydratedState["queries"]
  ) => Effect.Effect<
    DehydratedState["queries"],
    Schema.SchemaError | HydrationCodecError,
    EncodingServices
  >;
  readonly decodeQueries: (
    queries: DehydratedState["queries"]
  ) => Effect.Effect<
    DehydratedState["queries"],
    Schema.SchemaError | HydrationCodecError,
    DecodingServices
  >;
}

/** Indexes explicit leaf/view codecs without owning a QueryClient, runner, or serialization. */
export const createHydrationRegistry = <
  const Entries extends readonly HydrationCodec<
    unknown,
    unknown,
    unknown,
    unknown
  >[],
>(
  entries: Entries
): HydrationRegistry<
  Entries[number]["schema"]["DecodingServices"],
  Entries[number]["schema"]["EncodingServices"]
> => {
  type Entry = Entries[number];
  interface LengthBucket {
    readonly length: number;
    readonly byHash: Map<string, Entry>;
    lastSegments: Set<PrimitiveHashSegment> | undefined;
    firstSegments: Set<PrimitiveHashSegment> | undefined;
  }
  const byLength = new Map<number, LengthBucket>();
  const codecs: readonly Entry[] = entries;
  for (const codec of codecs) {
    const { length } = codec.prefix;
    let bucket = byLength.get(length);
    if (bucket === undefined) {
      bucket = {
        length,
        byHash: new Map<string, Entry>(),
        lastSegments: length > 0 ? new Set<PrimitiveHashSegment>() : undefined,
        firstSegments: length > 1 ? new Set<PrimitiveHashSegment>() : undefined,
      };
      byLength.set(length, bucket);
    }
    const hash = hashKey(codec.prefix);
    if (bucket.byHash.has(hash)) {
      throw new HydrationCodecError("DuplicateCodec");
    }
    bucket.byHash.set(hash, codec);
    if (bucket.lastSegments !== undefined) {
      const last = codec.prefix[length - 1];
      if (isPrimitiveHashSegment(last)) {
        bucket.lastSegments.add(last);
      } else {
        bucket.lastSegments = undefined;
      }
    }
    if (bucket.firstSegments !== undefined) {
      const [first] = codec.prefix;
      if (isPrimitiveHashSegment(first)) {
        bucket.firstSegments.add(first);
      } else {
        bucket.firstSegments = undefined;
      }
    }
  }
  const buckets = EffectArray.sort(
    byLength.keys(),
    Order.flip(Order.Number)
  ).flatMap((length) => {
    const bucket = byLength.get(length);
    return bucket === undefined ? [] : [bucket];
  });
  const minLength = buckets.at(-1)?.length ?? Number.POSITIVE_INFINITY;
  const codecFor = (key: QueryKey): Entry | undefined => {
    if (key.length < minLength) {
      return undefined;
    }
    for (const bucket of buckets) {
      if (key.length < bucket.length) {
        continue;
      }
      if (
        bucket.lastSegments !== undefined &&
        !hasPrimitiveSegment(bucket.lastSegments, key[bucket.length - 1])
      ) {
        continue;
      }
      if (
        bucket.firstSegments !== undefined &&
        !hasPrimitiveSegment(bucket.firstSegments, key[0])
      ) {
        continue;
      }
      const codec = bucket.byHash.get(hashKey(key.slice(0, bucket.length)));
      if (codec !== undefined) {
        return codec;
      }
    }
    return undefined;
  };
  const transform = <R>(
    queries: DehydratedState["queries"],
    convert: (
      codec: Entry,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters
      data: unknown
    ) => Effect.Effect<unknown, Schema.SchemaError, R>
  ) =>
    Effect.forEach(
      Effect.fnUntraced(function* transformQuery(query: Queries[number]) {
        if (query.state.status !== "success" || query.promise !== undefined) {
          return yield* Effect.fail(new HydrationCodecError("UnsettledQuery"));
        }
        const codec = codecFor(query.queryKey);
        if (codec === undefined) {
          return yield* Effect.fail(new HydrationCodecError("UnknownQuery"));
        }
        const data = yield* convert(codec, query.state.data);
        return { ...query, state: { ...query.state, data } };
      })
    )(queries);
  return {
    matches: (key) => codecFor(key) !== undefined,
    encodeQueries: (queries) =>
      transform(queries, (codec, data) =>
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
        Schema.encodeUnknownEffect(codec.schema)(data)
      ),
    decodeQueries: (queries) =>
      transform(queries, (codec, data) =>
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
        Schema.decodeUnknownEffect(codec.schema)(data)
      ),
  };
};
