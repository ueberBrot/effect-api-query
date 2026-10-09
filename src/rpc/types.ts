import type { DataTag, QueryKey } from '@tanstack/query-core'
import type { Context, Schema } from 'effect'
import type { Headers } from 'effect/http'
import type { Rpc, RpcClient, RpcGroup, RpcSchema } from 'effect/rpc'

import type {
  ContainsRedacted,
  InfiniteQueryBuilder,
  InfiniteQueryKey,
  UnaryQueryBuilder,
  JsonValue,
  QueryData,
  RunPromiseExit,
  MutationBuilder,
} from '../core/types'
import type { EffectRpcQueryEmptyStreamError, EffectRpcQueryError } from './errors'

/** Request-local options for unary queries, infinite queries, and mutations. */
export interface UnaryRpcOptions {
  readonly headers?: Headers.Input | undefined
  readonly context?: Context.Context<never> | undefined
  /** The generated query or mutation requires the RPC result. */
  readonly discard?: never
  /** Stream adaptation belongs to the package. */
  readonly asQueue?: never
}

/** Request-local options for accumulated-stream and live queries. */
export interface StreamingRpcOptions extends UnaryRpcOptions {
  readonly streamBufferSize?: number | undefined
}

export type RpcOptionsInput<Options = UnaryRpcOptions> = {
  readonly rpcOptions?: Options
}

/** Converts a normalized RPC payload into a synchronous, JSON-safe key value. */
export type KeyEncoder<R extends Rpc.Any> = (payload: Rpc.Payload<R>) => JsonValue

/** Extracts the literal RPC union retained by a group. */
export type RpcsOf<Group extends RpcGroup.Any> = RpcGroup.Rpcs<Group>

/** Extracts the payload Schema retained by an RPC definition. */
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
    : never

/** Retains only streaming RPC definitions. */
export type StreamingRpc<R extends Rpc.Any> =
  Rpc.SuccessSchema<R> extends RpcSchema.Stream<Schema.Top, Schema.Top> ? R : never

/** Selects RPCs whose query keys include constructed payload identity. */
export type PayloadBearingRpcs<Group extends RpcGroup.Any> =
  RpcsOf<Group> extends infer R
    ? R extends Rpc.Any
      ? void extends Rpc.PayloadConstructor<R>
        ? never
        : R
      : never
    : never

/** Extracts failures introduced by client-side RPC middleware. */
export type ClientMiddlewareError<R extends Rpc.Any> =
  R extends Rpc.Rpc<string, Schema.Top, Schema.Top, Schema.Top, infer Middleware, unknown>
    ? Middleware['~ClientError']
    : never

/** Every typed failure that can reach an RPC client call. */
export type RpcFailure<R extends Rpc.Any, ClientError> =
  | Rpc.Error<R>
  | ClientMiddlewareError<R>
  | ClientError

/** Every typed failure that can reach a streaming RPC consumer. */
export type RpcStreamFailure<R extends Rpc.Any, ClientError> =
  | Rpc.ErrorExit<R>
  | ClientMiddlewareError<R>
  | ClientError

export type RpcLiveError<R extends Rpc.Any, ClientError> =
  | EffectRpcQueryEmptyStreamError
  | EffectRpcQueryError<RpcStreamFailure<R, ClientError>>

/** Splits a literal dotted RPC tag into its path tuple. */
export type Segments<Tag extends string> = Tag extends `${infer Head}.${infer Tail}`
  ? readonly [Head, ...Segments<Tail>]
  : readonly [Tag]

export type RpcKey<Prefix extends readonly JsonValue[], R extends Rpc.Any> = readonly [
  ...Prefix,
  'rpc',
  ...Segments<R['_tag']>,
]

export type QueryOperationKey<Prefix extends readonly JsonValue[], R extends Rpc.Any> = readonly [
  ...RpcKey<Prefix, R>,
  'query',
]

export type InfiniteOperationKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
> = readonly [...RpcKey<Prefix, R>, 'infinite']

export type StreamedOperationKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
> = readonly [...RpcKey<Prefix, R>, 'streamed']

export type LiveOperationKey<Prefix extends readonly JsonValue[], R extends Rpc.Any> = readonly [
  ...RpcKey<Prefix, R>,
  'live',
]

/** A payload-specific key carrying Query Core's inferred data and error tags. */
export type ConcreteQueryKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
  ClientError,
> = DataTag<
  void extends Rpc.PayloadConstructor<R>
    ? QueryOperationKey<Prefix, R>
    : readonly [...QueryOperationKey<Prefix, R>, JsonValue],
  QueryData<Rpc.Success<R>>,
  EffectRpcQueryError<RpcFailure<R, ClientError>>
>

export type MutationKey<Prefix extends readonly JsonValue[], R extends Rpc.Any> = readonly [
  ...RpcKey<Prefix, R>,
  'mutation',
]

/** Supplies RPC inference to the shared unary query builder. */
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
  RpcOptionsInput
>

export type QueryKeyBuilder<R extends Rpc.Any, Prefix extends readonly JsonValue[], ClientError> =
  void extends Rpc.PayloadConstructor<R>
    ? () => ConcreteQueryKey<Prefix, R, ClientError>
    : (input: Rpc.PayloadConstructor<R>) => ConcreteQueryKey<Prefix, R, ClientError>

/** A payload-specific infinite key carrying Query Core's inferred data and error tags. */
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
  PageParam
>

/** Supplies RPC payload and request-local options to the shared infinite query builder. */
export type InfiniteOptionsBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> = InfiniteQueryBuilder<
  Rpc.PayloadConstructor<R>,
  QueryData<Rpc.Success<R>>,
  EffectRpcQueryError<RpcFailure<R, ClientError>>,
  InfiniteOperationKey<Prefix, R>,
  RpcOptionsInput
>

export type InfiniteKeyBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> =
  void extends Rpc.PayloadConstructor<R>
    ? () => ConcreteInfiniteKey<Prefix, R, ClientError>
    : (input: Rpc.PayloadConstructor<R>) => ConcreteInfiniteKey<Prefix, R, ClientError>

/** The accumulated data cached for a streaming RPC. */
export type StreamedData<R extends Rpc.Any> = readonly Rpc.SuccessChunk<R>[]

/** A payload-specific accumulated-stream key carrying Query Core's inferred tags. */
export type ConcreteStreamedKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
  ClientError,
> = DataTag<
  void extends Rpc.PayloadConstructor<R>
    ? StreamedOperationKey<Prefix, R>
    : readonly [...StreamedOperationKey<Prefix, R>, JsonValue],
  StreamedData<R>,
  EffectRpcQueryError<RpcStreamFailure<R, ClientError>>
>

/** A payload-specific latest-value key carrying Query Core's inferred tags. */
export type ConcreteLiveKey<
  Prefix extends readonly JsonValue[],
  R extends Rpc.Any,
  ClientError,
> = DataTag<
  void extends Rpc.PayloadConstructor<R>
    ? LiveOperationKey<Prefix, R>
    : readonly [...LiveOperationKey<Prefix, R>, JsonValue],
  QueryData<Rpc.SuccessChunk<R>>,
  RpcLiveError<R, ClientError>
>

export type StreamRefetchMode = 'append' | 'replace' | 'reset'

export type StreamedPolicyOptions = {
  /** Controls whether a refetch clears, appends to, or replaces accumulated data. */
  readonly refetchMode?: StreamRefetchMode
  /** Retains at most this many newest elements; must be a positive safe integer. */
  readonly maxChunks?: number
}

/** Shares query inference across accumulated and live queries, including conditional inputs. */
export type StreamingQueryBuilder<
  Input,
  Data,
  Error,
  Key extends QueryKey,
  SkippedKey extends QueryKey,
  Policy = unknown,
> = UnaryQueryBuilder<
  Input,
  Data,
  Error,
  Key,
  SkippedKey,
  Policy & RpcOptionsInput<StreamingRpcOptions>
>

export type StreamedOptionsBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> = StreamingQueryBuilder<
  Rpc.PayloadConstructor<R>,
  StreamedData<R>,
  EffectRpcQueryError<RpcStreamFailure<R, ClientError>>,
  ConcreteStreamedKey<Prefix, R, ClientError>,
  StreamedOperationKey<Prefix, R>,
  StreamedPolicyOptions
>

export type LiveOptionsBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> = StreamingQueryBuilder<
  Rpc.PayloadConstructor<R>,
  QueryData<Rpc.SuccessChunk<R>>,
  RpcLiveError<R, ClientError>,
  ConcreteLiveKey<Prefix, R, ClientError>,
  LiveOperationKey<Prefix, R>
>

export type StreamKeyBuilder<R extends Rpc.Any, Key> =
  void extends Rpc.PayloadConstructor<R> ? () => Key : (input: Rpc.PayloadConstructor<R>) => Key

/** The key and option builders exposed at one streaming RPC path. */
export interface RpcStreamLeaf<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> {
  /** Returns the immutable key prefix for this streaming RPC. */
  readonly key: () => RpcKey<Prefix, R>

  /** Builds a semantic key for the latest-value view of the stream. */
  readonly liveKey: StreamKeyBuilder<R, ConcreteLiveKey<Prefix, R, ClientError>>

  readonly liveOptions: LiveOptionsBuilder<R, Prefix, ClientError>

  /** Builds a semantic key for the accumulated view of the stream. */
  readonly streamedKey: StreamKeyBuilder<R, ConcreteStreamedKey<Prefix, R, ClientError>>

  /** Builds accumulated streamed-query options with Query Core refetch semantics. */
  readonly streamedOptions: StreamedOptionsBuilder<R, Prefix, ClientError>
}

/** The key and option builders exposed at one unary RPC path. */
export interface RpcQueryLeaf<R extends Rpc.Any, Prefix extends readonly JsonValue[], ClientError> {
  /** Builds a semantic, data-tagged infinite-query key from constructor input. */
  readonly infiniteKey: InfiniteKeyBuilder<R, Prefix, ClientError>

  /** Builds fresh Query Core infinite-query options from a page-input mapper or `skipToken`. */
  readonly infiniteOptions: InfiniteOptionsBuilder<R, Prefix, ClientError>

  /** Returns the immutable key prefix for this RPC. */
  readonly key: () => RpcKey<Prefix, R>

  /** Returns the immutable key shared by every mutation of this RPC. */
  readonly mutationKey: () => MutationKey<Prefix, R>

  /** Builds fresh Query Core mutation options without binding variables. */
  readonly mutationOptions: MutationBuilder<
    Rpc.Success<R>,
    EffectRpcQueryError<RpcFailure<R, ClientError>>,
    Rpc.PayloadConstructor<R>,
    MutationKey<Prefix, R>,
    RpcOptionsInput
  >

  /** Builds a semantic, data-tagged query key from constructor input. */
  readonly queryKey: QueryKeyBuilder<R, Prefix, ClientError>

  /** Builds fresh Query Core query options from constructor input or `skipToken`. */
  readonly queryOptions: QueryOptionsBuilder<R, Prefix, ClientError>
}

// Each tag becomes one nested object; intersections merge siblings at shared branches.
export type PathTree<
  Tag extends string,
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
  Path extends readonly string[] = readonly [],
> = Tag extends `${infer Head}.${infer Tail}`
  ? Readonly<
      Record<
        Head,
        {
          /** Returns the immutable key prefix for this RPC namespace. */
          readonly key: () => readonly [...Prefix, 'rpc', ...Path, Head]
        } & PathTree<Tail, R, Prefix, ClientError, readonly [...Path, Head]>
      >
    >
  : Readonly<
      Record<
        Tag,
        StreamingRpc<R> extends never
          ? RpcQueryLeaf<R, Prefix, ClientError>
          : RpcStreamLeaf<R, Prefix, ClientError>
      >
    >

/** Merges every projected RPC path into one nested utility object. */
export type UnionToIntersection<Union> = (
  Union extends unknown ? (value: Union) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never

/** An eager utility tree projected from the group's dotted RPC tags. */
export type RpcQueryUtils<
  Group extends RpcGroup.Any,
  Prefix extends readonly [JsonValue, ...JsonValue[]],
  ClientError = never,
> = {
  /** Returns the immutable root key, including the RPC discriminator. */
  readonly key: () => readonly [...Prefix, 'rpc']
} & UnionToIntersection<
  RpcsOf<Group> extends infer R
    ? R extends Rpc.Any
      ? PathTree<R['_tag'], R, Prefix, ClientError>
      : never
    : never
>

/** Whether default synchronous encoding is unsafe or requires Effect services. */
export type NeedsKeyEncoder<R extends Rpc.Any> = [PayloadSchema<R>['EncodingServices']] extends [
  never,
]
  ? true extends ContainsRedacted<Rpc.Payload<R>>
    ? true
    : false
  : true

/** Selects RPCs whose default key encoding is unsafe or cannot run synchronously. */
export type RequiredEncoderRpcs<Group extends RpcGroup.Any> =
  PayloadBearingRpcs<Group> extends infer R
    ? R extends Rpc.Any
      ? NeedsKeyEncoder<R> extends true
        ? R
        : never
      : never
    : never

/** An exact encoder map requiring entries for unsafe payloads or those needing encoding services. */
export type KeyEncoders<Group extends RpcGroup.Any> = {
  readonly [R in RequiredEncoderRpcs<Group> as R['_tag']]: KeyEncoder<R>
} & Partial<{
  readonly [
    R in Exclude<PayloadBearingRpcs<Group>, RequiredEncoderRpcs<Group>> as R['_tag']
  ]: KeyEncoder<R>
}>

/** Makes the encoder map optional only when no RPC requires an override. */
export type KeyEncoderOption<Group extends RpcGroup.Any> = [PayloadBearingRpcs<Group>] extends [
  never,
]
  ? { readonly keyEncoders?: never }
  : [RequiredEncoderRpcs<Group>] extends [never]
    ? {
        /** Overrides synchronous semantic encoding for selected RPC payloads. */
        readonly keyEncoders?: KeyEncoders<Group>
      }
    : {
        /**
         * Supplies safe synchronous identity for payloads that need encoding services or contain
         * redacted values.
         */
        readonly keyEncoders: KeyEncoders<Group>
      }

/** Requires a custom runner when client-side Schema services remain. */
export type RunnerOption<Group extends RpcGroup.Any> = [Rpc.ServicesClient<RpcsOf<Group>>] extends [
  never,
]
  ? {
      /** Overrides service-free execution; defaults to `Effect.runPromiseExit`. */
      readonly runPromiseExit?: RunPromiseExit
    }
  : {
      /** Runs RPC Effects that retain client-side Schema services. */
      readonly runPromiseExit: RunPromiseExit<Rpc.ServicesClient<RpcsOf<Group>>>
    }

/** Configuration for deriving a utility tree from an Effect RPC group. */
export type CreateRpcQueryUtilsOptions<
  Group extends RpcGroup.Any,
  Prefix extends readonly [JsonValue, ...JsonValue[]],
  ClientError = never,
> = {
  /** A ready, flat RPC client whose Scope remains owned by the caller. */
  readonly client: RpcClient.RpcClient.Flat<RpcsOf<Group>, ClientError>

  /** A non-empty JSON-safe tuple that namespaces every generated key. */
  readonly keyPrefix: Prefix
} & KeyEncoderOption<Group> &
  RunnerOption<Group>
