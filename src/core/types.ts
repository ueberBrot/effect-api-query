import type {
  DataTag,
  InfiniteData,
  InfiniteQueryObserverOptions,
  InitialDataFunction,
  MutationObserverOptions,
  NonUndefinedGuard,
  QueryFunction,
  QueryKey,
  QueryKeyHashFunction,
  QueryObserverOptions,
  SkipToken,
} from '@tanstack/query-core'
import type { Effect, Exit, Redacted } from 'effect'

/** A JSON scalar accepted in key prefixes and canonical key payloads. */
export type JsonPrimitive = boolean | null | number | string

/** An immutable JSON value accepted in cache keys. */
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]

/**
 * The value cached for a successful buffered query or live stream emission.
 *
 * TanStack rejects `undefined` query data, so possible `undefined` values become
 * `null`. Accumulated stream elements and mutation results keep their success types unchanged.
 */
export type QueryData<A> = undefined extends A ? Exclude<A, undefined | void> | null : A

/** Runs an Effect and returns its Exit, optionally forwarding an abort signal. */
export type RunPromiseExit<R = never> = <A, E>(
  effect: Effect.Effect<A, E, R>,
  options?: { readonly signal?: AbortSignal },
) => Promise<Exit.Exit<A, E>>

export type OwnedQueryOption = 'queryFn' | 'queryKey' | 'queryKeyHashFn' | 'queryHash'
export type OwnedMutationOption = 'mutationFn' | 'mutationKey'

/** Retains the initial-data guarantee through a generated options overload. */
export type WithDefinedInitialData<Options, Data> = Omit<Options, 'initialData'> & {
  readonly initialData: NonUndefinedGuard<Data> | (() => NonUndefinedGuard<Data>)
}

/** Keeps initialData optional in the non-defined overload. */
export type WithUndefinedInitialData<Options, Data> = Omit<Options, 'initialData'> & {
  readonly initialData?:
    | undefined
    | InitialDataFunction<NonUndefinedGuard<Data>>
    | NonUndefinedGuard<Data>
}

/** Shared Query Core fields plus the adapter's request-local options. */
export type QueryInput<
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  AdapterOptions = unknown,
> = Omit<QueryObserverOptions<Data, Error, Selected, Data, Key>, OwnedQueryOption> & AdapterOptions

export type QueryOptions<
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  Fn = QueryFunction<Data, Key>,
> = QueryInput<Data, Error, Selected, Key> & {
  readonly queryFn: Fn
  readonly queryKey: Key
  readonly queryKeyHashFn: QueryKeyHashFunction<Key>
}

export type ConditionalQueryOptions<Data, Error, Selected, Key extends QueryKey> = QueryOptions<
  Data,
  Error,
  Selected,
  Key,
  QueryFunction<Data, Key> | SkipToken
>

/** Owns unary query inference; adapters supply their request, data, error, and key types. */
export type UnaryQueryBuilder<
  Input,
  Data,
  Error,
  Key extends QueryKey,
  SkippedKey extends QueryKey,
  AdapterOptions = unknown,
> = void extends Input
  ? {
      <Selected = Data>(
        options: WithDefinedInitialData<
          QueryInput<Data, Error, Selected, Key, AdapterOptions>,
          Data
        >,
      ): WithDefinedInitialData<QueryOptions<Data, Error, Selected, Key>, Data>
      <Selected = Data>(
        options?: WithUndefinedInitialData<
          QueryInput<Data, Error, Selected, Key, AdapterOptions>,
          Data
        >,
      ): QueryOptions<Data, Error, Selected, Key>
    }
  : {
      <Selected = Data>(
        options: WithDefinedInitialData<
          QueryInput<Data, Error, Selected, Key, AdapterOptions>,
          Data
        > & { readonly input: Input },
      ): WithDefinedInitialData<QueryOptions<Data, Error, Selected, Key>, Data>
      <Selected = Data>(
        options: WithUndefinedInitialData<
          QueryInput<Data, Error, Selected, Key, AdapterOptions>,
          Data
        > & { readonly input: Input },
      ): QueryOptions<Data, Error, Selected, Key>
      <Selected = Data>(
        options: WithDefinedInitialData<
          Omit<QueryOptions<Data, Error, Selected, SkippedKey, SkipToken>, OwnedQueryOption>,
          Data
        > &
          AdapterOptions & { readonly input: SkipToken },
      ): WithDefinedInitialData<QueryOptions<Data, Error, Selected, SkippedKey, SkipToken>, Data>
      <Selected = Data>(
        options: WithUndefinedInitialData<
          Omit<QueryOptions<Data, Error, Selected, SkippedKey, SkipToken>, OwnedQueryOption>,
          Data
        > &
          AdapterOptions & { readonly input: SkipToken },
      ): QueryOptions<Data, Error, Selected, SkippedKey, SkipToken>
      <Selected = Data>(
        options: WithDefinedInitialData<
          Omit<ConditionalQueryOptions<Data, Error, Selected, Key | SkippedKey>, OwnedQueryOption>,
          Data
        > &
          AdapterOptions & { readonly input: Input | SkipToken },
      ): WithDefinedInitialData<
        ConditionalQueryOptions<Data, Error, Selected, Key | SkippedKey>,
        Data
      >
      <Selected = Data>(
        options: WithUndefinedInitialData<
          Omit<ConditionalQueryOptions<Data, Error, Selected, Key | SkippedKey>, OwnedQueryOption>,
          Data
        > &
          AdapterOptions & { readonly input: Input | SkipToken },
      ): ConditionalQueryOptions<Data, Error, Selected, Key | SkippedKey>
      (token: SkipToken): QueryOptions<Data, Error, Data, SkippedKey, SkipToken>
    }

export type InfiniteInput<
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  PageParam,
  AdapterOptions = unknown,
> = Omit<InfiniteQueryObserverOptions<Data, Error, Selected, Key, PageParam>, OwnedQueryOption> &
  AdapterOptions

export type InfiniteOptions<
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  PageParam,
  Fn = QueryFunction<Data, Key, PageParam>,
> = InfiniteInput<Data, Error, Selected, Key, PageParam> & {
  readonly queryFn: Fn
  readonly queryKey: Key
  readonly queryKeyHashFn: QueryKeyHashFunction<Key>
}

/** Tags concrete infinite keys with their cached pages and inferred page parameter. */
export type InfiniteQueryKey<
  Input,
  Data,
  Error,
  OperationKey extends readonly JsonValue[],
  PageParam = unknown,
> = DataTag<
  void extends Input ? OperationKey : readonly [...OperationKey, JsonValue],
  InfiniteData<Data, PageParam>,
  Error
>

export type MappedInfiniteInput<
  Input,
  Data,
  Error,
  OperationKey extends readonly JsonValue[],
  Selected,
  PageParam,
  AdapterOptions,
> = InfiniteInput<
  Data,
  Error,
  Selected,
  InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam>,
  PageParam,
  AdapterOptions
> &
  (void extends Input ? unknown : { readonly input: (pageParam: PageParam) => Input })

export type ConditionalInfiniteOptions<
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  PageParam,
> = InfiniteOptions<
  Data,
  Error,
  Selected,
  Key,
  PageParam,
  QueryFunction<Data, Key, PageParam> | SkipToken
>

/** Owns infinite-query inference while adapters supply request, data, error, and operation keys. */
export type InfiniteQueryBuilder<
  Input,
  Data,
  Error,
  OperationKey extends readonly JsonValue[],
  AdapterOptions = unknown,
> = {
  <PageParam, Selected = InfiniteData<Data, PageParam>>(
    options: WithDefinedInitialData<
      MappedInfiniteInput<Input, Data, Error, OperationKey, Selected, PageParam, AdapterOptions>,
      InfiniteData<Data, PageParam>
    >,
  ): WithDefinedInitialData<
    InfiniteOptions<
      Data,
      Error,
      Selected,
      InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam>,
      PageParam
    >,
    InfiniteData<Data, PageParam>
  >
  <PageParam, Selected = InfiniteData<Data, PageParam>>(
    options: WithUndefinedInitialData<
      MappedInfiniteInput<Input, Data, Error, OperationKey, Selected, PageParam, AdapterOptions>,
      InfiniteData<Data, PageParam>
    >,
  ): InfiniteOptions<
    Data,
    Error,
    Selected,
    InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam>,
    PageParam
  >
} & (void extends Input
  ? unknown
  : {
      <PageParam, Selected = InfiniteData<Data, PageParam>>(
        options: WithDefinedInitialData<
          InfiniteInput<Data, Error, Selected, OperationKey, PageParam, AdapterOptions>,
          InfiniteData<Data, PageParam>
        > & { readonly input: SkipToken },
      ): WithDefinedInitialData<
        InfiniteOptions<Data, Error, Selected, OperationKey, PageParam, SkipToken>,
        InfiniteData<Data, PageParam>
      >
      <PageParam, Selected = InfiniteData<Data, PageParam>>(
        options: WithUndefinedInitialData<
          InfiniteInput<Data, Error, Selected, OperationKey, PageParam, AdapterOptions>,
          InfiniteData<Data, PageParam>
        > & { readonly input: SkipToken },
      ): InfiniteOptions<Data, Error, Selected, OperationKey, PageParam, SkipToken>
      <PageParam, Selected = InfiniteData<Data, PageParam>>(
        options: WithDefinedInitialData<
          InfiniteInput<
            Data,
            Error,
            Selected,
            InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam> | OperationKey,
            PageParam,
            AdapterOptions
          >,
          InfiniteData<Data, PageParam>
        > & { readonly input: ((pageParam: PageParam) => Input) | SkipToken },
      ): WithDefinedInitialData<
        ConditionalInfiniteOptions<
          Data,
          Error,
          Selected,
          InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam> | OperationKey,
          PageParam
        >,
        InfiniteData<Data, PageParam>
      >
      <PageParam, Selected = InfiniteData<Data, PageParam>>(
        options: WithUndefinedInitialData<
          InfiniteInput<
            Data,
            Error,
            Selected,
            InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam> | OperationKey,
            PageParam,
            AdapterOptions
          >,
          InfiniteData<Data, PageParam>
        > & { readonly input: ((pageParam: PageParam) => Input) | SkipToken },
      ): ConditionalInfiniteOptions<
        Data,
        Error,
        Selected,
        InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam> | OperationKey,
        PageParam
      >
    })

export type MutationOptions<Data, Error, Input, Key extends QueryKey, OnMutateResult> = Omit<
  MutationObserverOptions<Data, Error, Input, OnMutateResult>,
  OwnedMutationOption
> & {
  readonly mutationFn: (variables: Input) => Promise<Data>
  readonly mutationKey: Key
}

/** Owns mutation callback inference while adapters supply their request and execution types. */
export type MutationBuilder<Data, Error, Input, Key extends QueryKey, AdapterOptions = unknown> = <
  OnMutateResult = unknown,
>(
  options?: Omit<MutationObserverOptions<Data, Error, Input, OnMutateResult>, OwnedMutationOption> &
    AdapterOptions,
) => MutationOptions<Data, Error, Input, Key, OnMutateResult>

// Generic function comparison tests exact type identity, not a callable API.
/* oxlint-disable typescript/no-unnecessary-type-parameters */
export type HasSeenType<A, Seen> = Seen extends unknown
  ? (<T>() => T extends A ? 1 : 2) extends <T>() => T extends Seen ? 1 : 2
    ? true
    : false
  : never
/* oxlint-enable typescript/no-unnecessary-type-parameters */

/** Recursively detects explicit redacted values in a decoded value. */
export type ContainsRedacted<A, Seen = never> =
  A extends Redacted.Redacted<unknown>
    ? true
    : true extends HasSeenType<A, Seen>
      ? false
      : A extends readonly (infer Value)[]
        ? ContainsRedacted<Value, Seen | A>
        : A extends object
          ? true extends { readonly [Key in keyof A]: ContainsRedacted<A[Key], Seen | A> }[keyof A]
            ? true
            : false
          : false
