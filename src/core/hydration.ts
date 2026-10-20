import { hashKey } from "@tanstack/query-core";
import type { DehydratedState, QueryKey } from "@tanstack/query-core";
import { Array as EffectArray, Effect, Order, Schema } from "effect";

import type { InferQueryData, SupportedQueryView } from "./inference";
import { viewPrefix } from "./view-prefix";

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
  return Object.freeze({
    prefix,
    schema,
    matches: (key: QueryKey) =>
      key.length >= prefix.length &&
      hashKey(key.slice(0, prefix.length)) === hash,
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
  const byLength = new Map<number, Map<string, Entry>>();
  const codecs: readonly Entry[] = entries;
  for (const codec of codecs) {
    const lengthCodecs =
      byLength.get(codec.prefix.length) ?? new Map<string, Entry>();
    const hash = hashKey(codec.prefix);
    if (lengthCodecs.has(hash)) {
      throw new HydrationCodecError("DuplicateCodec");
    }
    lengthCodecs.set(hash, codec);
    byLength.set(codec.prefix.length, lengthCodecs);
  }
  const lengths = EffectArray.sort(byLength.keys(), Order.flip(Order.Number));
  const codecFor = (key: QueryKey): Entry | undefined => {
    for (const length of lengths) {
      if (key.length >= length) {
        const codec = byLength.get(length)?.get(hashKey(key.slice(0, length)));
        if (codec !== undefined) {
          return codec;
        }
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
