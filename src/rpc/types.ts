import type {
  DataTag,
  InfiniteData,
  MutationObserverOptions,
  QueryKey,
  SkipToken,
} from '@tanstack/query-core'
import type { Context, Schema } from 'effect'
import type { Headers } from 'effect/unstable/http'
import type { Rpc, RpcClient, RpcGroup, RpcSchema } from 'effect/unstable/rpc'

import type {
  ContainsRedacted,
  UnaryQueryBuilder,
  JsonValue,
  QueryData,
  RunPromiseExit,
  OwnedQueryOption,
  OwnedMutationOption,
  WithDefinedInitialData,
  WithUndefinedInitialData,
  QueryInput,
  QueryOptions,
  InfiniteInput,
  InfiniteOptions,
  MutationOptions,
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

/** Mutation options generated for one unary RPC. */
export type RpcMutationOptions<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
  OnMutateResult = unknown,
> = MutationOptions<
  Rpc.Success<R>,
  EffectRpcQueryError<RpcFailure<R, ClientError>>,
  Rpc.PayloadConstructor<R>,
  MutationKey<Prefix, R>,
  OnMutateResult
>

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
> = DataTag<
  void extends Rpc.PayloadConstructor<R>
    ? InfiniteOperationKey<Prefix, R>
    : readonly [...InfiniteOperationKey<Prefix, R>, JsonValue],
  InfiniteData<QueryData<Rpc.Success<R>>, PageParam>,
  EffectRpcQueryError<RpcFailure<R, ClientError>>
>

/** Infinite-query inputs after removing fields owned by this package. */
export type InfiniteInputOptions<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
  Selected,
  PageParam,
> = InfiniteInput<
  QueryData<Rpc.Success<R>>,
  EffectRpcQueryError<RpcFailure<R, ClientError>>,
  Selected,
  ConcreteInfiniteKey<Prefix, R, ClientError, PageParam>,
  PageParam,
  RpcOptionsInput
>

/** Infinite-query options generated for one unary RPC. */
export type RpcInfiniteOptions<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
  Selected,
  PageParam,
> = InfiniteOptions<
  QueryData<Rpc.Success<R>>,
  EffectRpcQueryError<RpcFailure<R, ClientError>>,
  Selected,
  ConcreteInfiniteKey<Prefix, R, ClientError, PageParam>,
  PageParam
>

/** Query Core options returned when a payload-bearing infinite query uses `skipToken`. */
export type SkippedRpcInfiniteOptions<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
  PageParam,
  Selected = InfiniteData<QueryData<Rpc.Success<R>>, PageParam>,
> = InfiniteOptions<
  QueryData<Rpc.Success<R>>,
  EffectRpcQueryError<RpcFailure<R, ClientError>>,
  Selected,
  InfiniteOperationKey<Prefix, R>,
  PageParam,
  SkipToken
>

/** Builds infinite-query options from page parameters or the exact skip sentinel. */
export type InfiniteOptionsBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> =
  void extends Rpc.PayloadConstructor<R>
    ? <PageParam, Selected = InfiniteData<QueryData<Rpc.Success<R>>, PageParam>>(
        options: InfiniteInputOptions<R, Prefix, ClientError, Selected, PageParam>,
      ) => RpcInfiniteOptions<R, Prefix, ClientError, Selected, PageParam>
    : {
        <PageParam, Selected = InfiniteData<QueryData<Rpc.Success<R>>, PageParam>>(
          options: InfiniteInputOptions<R, Prefix, ClientError, Selected, PageParam> & {
            readonly input: (pageParam: PageParam) => Rpc.PayloadConstructor<R>
          },
        ): RpcInfiniteOptions<R, Prefix, ClientError, Selected, PageParam>
        <PageParam, Selected = InfiniteData<QueryData<Rpc.Success<R>>, PageParam>>(
          options: Omit<
            SkippedRpcInfiniteOptions<R, Prefix, ClientError, PageParam, Selected>,
            OwnedQueryOption
          > &
            RpcOptionsInput & {
              readonly input: SkipToken
            },
        ): SkippedRpcInfiniteOptions<R, Prefix, ClientError, PageParam, Selected>
      }

export type InfiniteKeyBuilder<
  R extends Rpc.Any,
  Prefix extends readonly JsonValue[],
  ClientError,
> =
  void extends Rpc.PayloadConstructor<R>
    ? () => ConcreteInfiniteKey<Prefix, R, ClientError>
    : (input: Rpc.PayloadConstructor<R>) => ConcreteInfiniteKey<Prefix, R, ClientError>

/** The accumulated data cached for a streaming RPC. */
export type StreamedData<R extends Rpc.Any> = ReadonlyArray<Rpc.SuccessChunk<R>>

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
  Rpc.SuccessChunk<R>,
  RpcLiveError<R, ClientError>
>

export type StreamRefetchMode = 'append' | 'replace' | 'reset'

export type StreamedPolicyOptions = {
  /** Controls whether a refetch clears, appends to, or replaces accumulated data. */
  readonly refetchMode?: StreamRefetchMode
  /** Retains at most this many newest elements; must be a positive safe integer. */
  readonly maxChunks?: number
}

/** Shares initial-data and exact-skip inference across accumulated and live queries. */
export type StreamingQueryBuilder<
  Input,
  Data,
  Error,
  Key extends QueryKey,
  SkippedKey extends QueryKey,
  Policy = unknown,
> = void extends Input
  ? {
      <Selected = Data>(
        options: WithDefinedInitialData<
          QueryInput<Data, Error, Selected, Key, Policy & RpcOptionsInput<StreamingRpcOptions>>,
          Data
        >,
      ): WithDefinedInitialData<QueryOptions<Data, Error, Selected, Key>, Data>
      <Selected = Data>(
        options?: WithUndefinedInitialData<
          QueryInput<Data, Error, Selected, Key, Policy & RpcOptionsInput<StreamingRpcOptions>>,
          Data
        >,
      ): QueryOptions<Data, Error, Selected, Key>
    }
  : {
      <Selected = Data>(
        options: WithDefinedInitialData<
          QueryInput<Data, Error, Selected, Key, Policy & RpcOptionsInput<StreamingRpcOptions>>,
          Data
        > & { readonly input: Input },
      ): WithDefinedInitialData<QueryOptions<Data, Error, Selected, Key>, Data>
      <Selected = Data>(
        options: WithUndefinedInitialData<
          QueryInput<Data, Error, Selected, Key, Policy & RpcOptionsInput<StreamingRpcOptions>>,
          Data
        > & { readonly input: Input },
      ): QueryOptions<Data, Error, Selected, Key>
      <Selected = Data>(
        options: WithDefinedInitialData<
          Omit<QueryOptions<Data, Error, Selected, SkippedKey, SkipToken>, OwnedQueryOption>,
          Data
        > &
          Policy &
          RpcOptionsInput<StreamingRpcOptions> & { readonly input: SkipToken },
      ): WithDefinedInitialData<QueryOptions<Data, Error, Selected, SkippedKey, SkipToken>, Data>
      <Selected = Data>(
        options: Omit<
          QueryOptions<Data, Error, Selected, SkippedKey, SkipToken>,
          OwnedQueryOption
        > &
          Policy &
          RpcOptionsInput<StreamingRpcOptions> & { readonly input: SkipToken },
      ): QueryOptions<Data, Error, Selected, SkippedKey, SkipToken>
      (token: SkipToken): QueryOptions<Data, Error, Data, SkippedKey, SkipToken>
    }

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
  Rpc.SuccessChunk<R>,
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

  /**
   * Builds latest-value query options. A stream that completes before its first value fails with
   * {@link EffectRpcQueryEmptyStreamError}.
   */
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
  readonly mutationOptions: <OnMutateResult = unknown>(
    options?: Omit<
      MutationObserverOptions<
        Rpc.Success<R>,
        EffectRpcQueryError<RpcFailure<R, ClientError>>,
        Rpc.PayloadConstructor<R>,
        OnMutateResult
      >,
      OwnedMutationOption
    > &
      RpcOptionsInput,
  ) => RpcMutationOptions<R, Prefix, ClientError, OnMutateResult>

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
  ? {
      readonly [Key in Head]: {
        /** Returns the immutable key prefix for this RPC namespace. */
        readonly key: () => readonly [...Prefix, 'rpc', ...Path, Head]
      } & PathTree<Tail, R, Prefix, ClientError, readonly [...Path, Head]>
    }
  : {
      readonly [Key in Tag]: StreamingRpc<R> extends never
        ? RpcQueryLeaf<R, Prefix, ClientError>
        : RpcStreamLeaf<R, Prefix, ClientError>
    }

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
