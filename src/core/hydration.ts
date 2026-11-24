import type { DehydratedState, QueryKey } from "@tanstack/query-core";
import { Effect, Predicate, Schema } from "effect";

import type {
  InferQueryData,
  QueryView,
  SupportedQueryView,
} from "./inference";
import { compileQueryPrefix, indexQueryPrefixes } from "./query-prefix-index";
import { generatedViewKeyLimit } from "./utility-key";
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
) =>
  Object.freeze({
    prefix,
    schema,
    matches: compileQueryPrefix(prefix, generatedViewKeyLimit(prefix)),
  });

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

/** Diagnostic codes reported by `HydrationCodecError`. */
export type HydrationCodecErrorCode =
  | "DuplicateCodec"
  | "UnknownQuery"
  | "UnsettledQuery"
  | "InvalidKeyPrefix"
  | "InvalidContractPath"
  | "UnknownPath"
  | "UnencodableSchema";

const defaultErrorMessages: Record<HydrationCodecErrorCode, string> = {
  DuplicateCodec:
    "A hydration codec is already registered for this leaf and view",
  UnknownQuery: "No hydration codec is registered for this query",
  UnsettledQuery:
    "Hydration codecs require successful queries without pending promises",
  InvalidKeyPrefix:
    "keyPrefix must be a non-empty readonly tuple of JSON-safe values",
  InvalidContractPath: "Contract path cannot be projected into a hydration key",
  UnknownPath: "No queryable contract operation exists for this hydration path",
  UnencodableSchema:
    "Contract schema cannot be encoded to JSON without an explicit override or opt-out",
};

/** Error raised for invalid hydration configuration, derivation, or snapshot queries. */
export class HydrationCodecError extends Error {
  readonly _tag = "HydrationCodecError";
  readonly code: HydrationCodecErrorCode;
  readonly path?: string | undefined;
  readonly view?: QueryView | undefined;

  constructor(
    code: HydrationCodecErrorCode,
    details?: {
      readonly message?: string | undefined;
      readonly path?: string | undefined;
      readonly view?: QueryView | undefined;
      readonly cause?: unknown;
    }
  ) {
    super(
      details?.message ?? defaultErrorMessages[code],
      details?.cause === undefined ? undefined : { cause: details.cause }
    );
    this.name = "HydrationCodecError";
    this.code = code;
    if (details?.path !== undefined) {
      this.path = details.path;
    }
    if (details?.view !== undefined) {
      this.view = details.view;
    }
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

/** A single manual codec or package-created hydration registry accepted by `createHydrationRegistry`. */
export type HydrationRegistryEntry =
  | HydrationCodec<unknown, unknown, unknown, unknown>
  | HydrationRegistry<unknown, unknown>;

export type EntryDecodingServices<Entry> =
  Entry extends HydrationCodec<unknown, unknown, infer Decoding, unknown>
    ? Decoding
    : Entry extends HydrationRegistry<infer Decoding, unknown>
      ? Decoding
      : never;

export type EntryEncodingServices<Entry> =
  Entry extends HydrationCodec<unknown, unknown, unknown, infer Encoding>
    ? Encoding
    : Entry extends HydrationRegistry<unknown, infer Encoding>
      ? Encoding
      : never;

export interface CompiledHydrationCodec {
  readonly prefix: QueryKey;
  readonly encode: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters
    data: unknown
  ) => Effect.Effect<unknown, Schema.SchemaError, unknown>;
  readonly decode: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters
    data: unknown
  ) => Effect.Effect<unknown, Schema.SchemaError, unknown>;
}

const packageRegistries = new WeakMap<
  object,
  readonly CompiledHydrationCodec[]
>();

export const compileHydrationCodec = (
  prefix: QueryKey,
  schema: Schema.Codec<unknown, unknown, unknown, unknown>,
  options?: {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns
    readonly postDecode?: (value: unknown) => unknown;
  }
): CompiledHydrationCodec => {
  const decode = Schema.decodeUnknownEffect(schema);
  const postDecode = options?.postDecode;
  return {
    prefix,
    encode: Schema.encodeUnknownEffect(schema),
    decode:
      postDecode === undefined
        ? decode
        : (data) =>
            // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
            Effect.map(decode(data), postDecode),
  };
};

export const buildHydrationRegistry = <
  DecodingServices = never,
  EncodingServices = never,
>(
  codecs: readonly CompiledHydrationCodec[]
): HydrationRegistry<DecodingServices, EncodingServices> => {
  const codecFor = indexQueryPrefixes(
    codecs.map(
      (codec) =>
        [codec.prefix, codec, generatedViewKeyLimit(codec.prefix)] as const
    ),
    { duplicateError: () => new HydrationCodecError("DuplicateCodec") }
  );
  const transform = <R>(
    queries: DehydratedState["queries"],
    convert: (
      codec: CompiledHydrationCodec,
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
  const registry: HydrationRegistry<DecodingServices, EncodingServices> = {
    matches: (key) => codecFor(key) !== undefined,
    encodeQueries: (queries) =>
      transform(
        queries,
        (codec, data) =>
          // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unsafe-effect-type-assertion, anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
          codec.encode(data) as Effect.Effect<
            unknown,
            Schema.SchemaError,
            EncodingServices
          >
      ),
    decodeQueries: (queries) =>
      transform(
        queries,
        (codec, data) =>
          // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unsafe-effect-type-assertion, anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
          codec.decode(data) as Effect.Effect<
            unknown,
            Schema.SchemaError,
            DecodingServices
          >
      ),
  };
  packageRegistries.set(registry, codecs);
  return registry;
};

const isHydrationCodec = (
  entry: unknown
): entry is HydrationCodec<unknown, unknown, unknown, unknown> =>
  Predicate.isObject(entry) &&
  Predicate.hasProperty(entry, "prefix") &&
  Array.isArray(entry.prefix) &&
  Predicate.hasProperty(entry, "schema") &&
  Schema.isSchema(entry.schema) &&
  Predicate.hasProperty(entry, "matches") &&
  Predicate.isFunction(entry.matches);

/** Indexes explicit leaf/view codecs and package-created hydration registries without owning a QueryClient, runner, or serialization. */
export const createHydrationRegistry = <
  const Entries extends readonly HydrationRegistryEntry[],
>(
  entries: Entries
): HydrationRegistry<
  EntryDecodingServices<Entries[number]>,
  EntryEncodingServices<Entries[number]>
> => {
  const compiled: CompiledHydrationCodec[] = [];
  for (const entry of entries) {
    if (Predicate.isObject(entry)) {
      const existing = packageRegistries.get(entry);
      if (existing !== undefined) {
        compiled.push(...existing);
        continue;
      }
    }
    if (isHydrationCodec(entry)) {
      compiled.push(compileHydrationCodec(entry.prefix, entry.schema));
      continue;
    }
    throw new HydrationCodecError("UnencodableSchema", {
      message:
        "Hydration registry entries must be HydrationCodec values or package-created HydrationRegistry instances",
    });
  }
  return buildHydrationRegistry<
    EntryDecodingServices<Entries[number]>,
    EntryEncodingServices<Entries[number]>
  >(compiled);
};
