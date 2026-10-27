import type { DataTag, QueryKey } from "@tanstack/query-core";
import type { Context, Schema, SchemaAST } from "effect";
import type { Headers } from "effect/http";
import type { Rpc, RpcClient, RpcGroup, RpcSchema } from "effect/rpc";

import type { PreparedInput } from "../core/prepared-input";
import type {
  ContainsRedacted,
  InfiniteQueryBuilder,
  InfiniteQueryKey,
  UnaryQueryBuilder,
  JsonValue,
  KeyBuilder,
  KeyEncoderRequirement,
  QueryData,
  RunnerRequirement,
  MutationBuilder,
  StreamedPolicyOptions,
} from "../core/types";
import type {
  EffectRpcQueryConfigError,
  EffectRpcQueryEmptyStreamError,
  EffectRpcQueryError,
} from "./errors";

/** Request-local options for unary queries, infinite queries, and mutations. */
export interface UnaryRpcOptions {
  readonly headers?: Headers.Input | undefined;
  readonly context?: Context.Context<never> | undefined;
  /** The generated query or mutation requires the RPC result. */
  readonly discard?: never;
  /** Stream adaptation belongs to the package. */
  readonly asQueue?: never;
  readonly streamBufferSize?: never;
}

/** Request-local options for accumulated-stream and live queries. */
export interface StreamingRpcOptions extends Omit<
  UnaryRpcOptions,
  "streamBufferSize"
> {
  readonly streamBufferSize?: number | undefined;
}

export interface RpcOptionsInput<Options = UnaryRpcOptions> {
  readonly rpcOptions?: Options;
}

/** Converts a normalized RPC payload into a synchronous, JSON-safe key value. */
export type KeyEncoder<R extends Rpc.Any> = (
  payload: Rpc.Payload<R>
) => JsonValue;

export type RpcsOf<Group extends RpcGroup.Any> = RpcGroup.Rpcs<Group>;

export type PayloadSchema<R extends Rpc.Any> =
  R extends Rpc.Rpc<
    infer _Tag,
    infer Payload,
    infer _Success,
    infer _Error,
    infer _Middleware,
    infer _Requires
  >
    ? Payload
    : never;

export type PayloadlessRpc<R extends Rpc.Any> = [
  PayloadSchema<R>["ast"],
] extends [SchemaAST.Void]
  ? true
  : false;

export type StreamingRpc<R extends Rpc.Any> =
  Rpc.SuccessSchema<R> extends RpcSchema.Stream<Schema.Top, Schema.Top>
    ? R
    : never;

export type PayloadBearingRpcs<Group extends RpcGroup.Any> =
  RpcsOf<Group> extends infer R
    ? R extends Rpc.Any
      ? PayloadlessRpc<R> extends true
        ? never
        : R
      : never
    : never;

export type ClientMiddlewareError<R extends Rpc.Any> =
  R extends Rpc.Rpc<
    string,
    Schema.Top,
    Schema.Top,
    Schema.Top,
    infer Middleware,
    unknown
  >
    ? Middleware["~ClientError"]
    : never;

export type RpcFailure<R extends Rpc.Any, ClientError> =
  | Rpc.Error<R>
  | ClientMiddlewareError<R>
  | ClientError;

export type RpcStreamFailure<R extends Rpc.Any, ClientError> =
  | Rpc.ErrorExit<R>
  | ClientMiddlewareError<R>
  | ClientError;

export type RpcStreamQueryError<R extends Rpc.Any, ClientError> =
  | EffectRpcQueryConfigError
  | EffectRpcQueryError<RpcStreamFailure<R, ClientError>>;

export type RpcLiveError<R extends Rpc.Any, ClientError> =
  | EffectRpcQueryEmptyStreamError
  | RpcStreamQueryError<R, ClientError>;

export type Segments<Tag extends string> =
  Tag extends `${infer Head}.${infer Tail}`
    ? readonly [Head, ...Segments<Tail>]
    : readonly [Tag];

export type RpcKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
> = readonly [...Prefix, "rpc", ...Segments<R["_tag"]>];

export type QueryOperationKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
> = readonly [...RpcKey<Prefix, R>, "query"];

export type InfiniteOperationKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
> = readonly [...RpcKey<Prefix, R>, "infinite"];

export type StreamedOperationKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
> = readonly [...RpcKey<Prefix, R>, "streamed"];

export type LiveOperationKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
> = readonly [...RpcKey<Prefix, R>, "live"];

export type ConcreteQueryKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
  ClientError,
> = DataTag<
  PayloadlessRpc<R> extends true
    ? QueryOperationKey<Prefix, R>
    : readonly [...QueryOperationKey<Prefix, R>, unknown],
  QueryData<Rpc.Success<R>>,
  EffectRpcQueryError<RpcFailure<R, ClientError>>
>;

export type MutationKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
> = readonly [...RpcKey<Prefix, R>, "mutation"];

export type QueryOptionsBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> = UnaryQueryBuilder<
  Rpc.PayloadConstructor<R>,
  QueryData<Rpc.Success<R>>,
  EffectRpcQueryError<RpcFailure<R, ClientError>>,
  ConcreteQueryKey<Prefix, R, ClientError>,
  QueryOperationKey<Prefix, R>,
  RpcOptionsInput,
  PayloadlessRpc<R>
>;

export type QueryKeyBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> = KeyBuilder<
  Rpc.PayloadConstructor<R>,
  ConcreteQueryKey<Prefix, R, ClientError>,
  PayloadlessRpc<R>
>;

export type ConcreteInfiniteKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
  ClientError,
  PageParam = unknown,
> = InfiniteQueryKey<
  Rpc.PayloadConstructor<R>,
  QueryData<Rpc.Success<R>>,
  EffectRpcQueryError<RpcFailure<R, ClientError>>,
  InfiniteOperationKey<Prefix, R>,
  PageParam,
  PayloadlessRpc<R>
>;

export type InfiniteOptionsBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> = InfiniteQueryBuilder<
  Rpc.PayloadConstructor<R>,
  QueryData<Rpc.Success<R>>,
  EffectRpcQueryError<RpcFailure<R, ClientError>>,
  InfiniteOperationKey<Prefix, R>,
  RpcOptionsInput,
  PayloadlessRpc<R>
>;

export type InfiniteKeyBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> = KeyBuilder<
  Rpc.PayloadConstructor<R>,
  ConcreteInfiniteKey<Prefix, R, ClientError>,
  PayloadlessRpc<R>
>;

export type StreamedData<R extends Rpc.Any> = readonly Rpc.SuccessChunk<R>[];

export type ConcreteStreamedKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
  ClientError,
> = DataTag<
  PayloadlessRpc<R> extends true
    ? readonly [...StreamedOperationKey<Prefix, R>, unknown]
    : readonly [...StreamedOperationKey<Prefix, R>, unknown, unknown],
  StreamedData<R>,
  RpcStreamQueryError<R, ClientError>
>;

export type ConcreteLiveKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
  ClientError,
> = DataTag<
  PayloadlessRpc<R> extends true
    ? LiveOperationKey<Prefix, R>
    : readonly [...LiveOperationKey<Prefix, R>, unknown],
  QueryData<Rpc.SuccessChunk<R>>,
  RpcLiveError<R, ClientError>
>;

export type StreamingQueryBuilder<
  Input,
  Data,
  Error,
  Key extends QueryKey,
  SkippedKey extends QueryKey,
  Policy = unknown,
  Inputless extends boolean = void extends Input ? true : false,
> = UnaryQueryBuilder<
  Input,
  Data,
  Error,
  Key,
  SkippedKey,
  Policy & RpcOptionsInput<StreamingRpcOptions>,
  Inputless
>;

export type StreamedOptionsBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> = StreamingQueryBuilder<
  Rpc.PayloadConstructor<R>,
  StreamedData<R>,
  RpcStreamQueryError<R, ClientError>,
  ConcreteStreamedKey<Prefix, R, ClientError>,
  StreamedOperationKey<Prefix, R>,
  StreamedPolicyOptions,
  PayloadlessRpc<R>
>;

export type LiveOptionsBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> = StreamingQueryBuilder<
  Rpc.PayloadConstructor<R>,
  QueryData<Rpc.SuccessChunk<R>>,
  RpcLiveError<R, ClientError>,
  ConcreteLiveKey<Prefix, R, ClientError>,
  LiveOperationKey<Prefix, R>,
  unknown,
  PayloadlessRpc<R>
>;

export type StreamKeyBuilder<R extends Rpc.Any, Key> = KeyBuilder<
  Rpc.PayloadConstructor<R>,
  Key,
  PayloadlessRpc<R>
>;

export type StreamedKeyBuilder<R extends Rpc.Any, Key> =
  PayloadlessRpc<R> extends true
    ? (policy: StreamedPolicyOptions) => Key
    : (
        input:
          | Rpc.PayloadConstructor<R>
          | PreparedInput<Rpc.PayloadConstructor<R>>,
        policy: StreamedPolicyOptions
      ) => Key;

/** The key and option builders exposed at one streaming RPC path. */
export interface RpcStreamLeaf<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> {
  /** Returns the immutable key prefix for this streaming RPC. */
  readonly key: () => RpcKey<Prefix, R>;

  /** Builds a semantic key for the latest-value view of the stream. */
  readonly liveKey: StreamKeyBuilder<
    R,
    ConcreteLiveKey<Prefix, R, ClientError>
  >;

  readonly liveOptions: LiveOptionsBuilder<R, Prefix, ClientError>;

  /** Builds a semantic key for the accumulated view of the stream. */
  readonly streamedKey: StreamedKeyBuilder<
    R,
    ConcreteStreamedKey<Prefix, R, ClientError>
  >;

  /** Builds accumulated streamed-query options with Query Core refetch semantics. */
  readonly streamedOptions: StreamedOptionsBuilder<R, Prefix, ClientError>;
}

/** The key and option builders exposed at one unary RPC path. */
export interface RpcQueryLeaf<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> {
  /** Builds a semantic, data-tagged infinite-query key from constructor input. */
  readonly infiniteKey: InfiniteKeyBuilder<R, Prefix, ClientError>;

  /** Builds fresh Query Core infinite-query options from a page-input mapper or `skipToken`. */
  readonly infiniteOptions: InfiniteOptionsBuilder<R, Prefix, ClientError>;

  /** Returns the immutable key prefix for this RPC. */
  readonly key: () => RpcKey<Prefix, R>;

  /** Returns the immutable key shared by every mutation of this RPC. */
  readonly mutationKey: () => MutationKey<Prefix, R>;

  /** Builds fresh Query Core mutation options without binding variables. */
  readonly mutationOptions: MutationBuilder<
    Rpc.Success<R>,
    EffectRpcQueryError<RpcFailure<R, ClientError>>,
    Rpc.PayloadConstructor<R>,
    MutationKey<Prefix, R>,
    RpcOptionsInput
  >;

  /** Builds a semantic, data-tagged query key from constructor input. */
  readonly queryKey: QueryKeyBuilder<R, Prefix, ClientError>;

  /** Builds fresh Query Core query options from constructor input or `skipToken`. */
  readonly queryOptions: QueryOptionsBuilder<R, Prefix, ClientError>;
}

export type RpcTagEntry<
  R extends Rpc.Any,
  Tag extends string,
> = Tag extends string
  ? { readonly path: Tag; readonly rpc: R & { readonly _tag: Tag } }
  : never;

export type RpcPathEntry<R extends Rpc.Any> = R extends Rpc.Any
  ? RpcTagEntry<R, R["_tag"]>
  : never;

export type PathHead<Path extends string> =
  Path extends `${infer Head}.${string}` ? Head : Path;

export type PathDescendants<Entry, Head extends string> = Entry extends {
  readonly path: `${Head}.${infer Tail}`;
  readonly rpc: infer R extends Rpc.Any;
}
  ? { readonly path: Tail; readonly rpc: R }
  : never;

export type PathTree<
  Entry extends { readonly path: string; readonly rpc: Rpc.Any },
  Prefix extends readonly JsonValue[],
  ClientError,
  Path extends readonly string[] = readonly [],
> = {
  readonly [Head in PathHead<Entry["path"]>]: [
    PathDescendants<Entry, Head>,
  ] extends [never]
    ? Extract<Entry, { readonly path: Head }>["rpc"] extends infer R extends
        Rpc.Any
      ? StreamingRpc<R> extends never
        ? RpcQueryLeaf<R, Prefix, ClientError>
        : RpcStreamLeaf<R, Prefix, ClientError>
      : never
    : {
        readonly key: () => readonly [...Prefix, "rpc", ...Path, Head];
      } & PathTree<
        PathDescendants<Entry, Head>,
        Prefix,
        ClientError,
        readonly [...Path, Head]
      >;
};

declare const rpcQueryClientError: unique symbol;

/** An eager utility tree projected from the group's dotted RPC tags. */
export type RpcQueryUtils<
  Group extends RpcGroup.Any,
  Prefix extends readonly [JsonValue, ...JsonValue[]],
  ClientError = never,
> = {
  readonly [rpcQueryClientError]?: ClientError;
  /** Returns the immutable root key, including the RPC discriminator. */
  readonly key: () => readonly [...Prefix, "rpc"];
} & PathTree<RpcPathEntry<RpcsOf<Group>>, Prefix, ClientError>;

export type NeedsKeyEncoder<R extends Rpc.Any> = [
  PayloadSchema<R>["EncodingServices"],
] extends [never]
  ? PayloadSchema<R>["ast"] extends SchemaAST.Any | SchemaAST.Unknown
    ? false
    : true extends ContainsRedacted<Rpc.Payload<R>>
      ? true
      : false
  : true;

export type RequiredEncoderRpcs<Group extends RpcGroup.Any> =
  PayloadBearingRpcs<Group> extends infer R
    ? R extends Rpc.Any
      ? NeedsKeyEncoder<R> extends true
        ? R
        : never
      : never
    : never;

export type KeyEncoders<Group extends RpcGroup.Any> = {
  readonly [R in RequiredEncoderRpcs<Group> as R["_tag"]]: KeyEncoder<R>;
} & Partial<{
  readonly [
    R in Exclude<
      PayloadBearingRpcs<Group>,
      RequiredEncoderRpcs<Group>
    > as R["_tag"]
  ]: KeyEncoder<R>;
}>;

/** Makes the encoder map optional only when no RPC requires an override. */
export type KeyEncoderOption<Group extends RpcGroup.Any> =
  KeyEncoderRequirement<
    PayloadBearingRpcs<Group>,
    RequiredEncoderRpcs<Group>,
    KeyEncoders<Group>
  >;

/** Requires a custom runner when client-side Schema services remain. */
export type RunnerOption<Group extends RpcGroup.Any> = RunnerRequirement<
  Rpc.ServicesClient<RpcsOf<Group>>
>;

/** Configuration for deriving a utility tree from an Effect RPC group. */
export type CreateRpcQueryUtilsOptions<
  Group extends RpcGroup.Any,
  Prefix extends readonly [JsonValue, ...JsonValue[]],
  ClientError = never,
> = {
  /** A ready, flat RPC client whose Scope remains owned by the caller. */
  readonly client: RpcClient.RpcClient.Flat<RpcsOf<Group>, ClientError>;

  /** A non-empty JSON-safe tuple that namespaces every generated key. */
  readonly keyPrefix: Prefix;
} & KeyEncoderOption<Group> &
  RunnerOption<Group>;
