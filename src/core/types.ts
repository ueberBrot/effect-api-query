import type {
  DataTag,
  InfiniteData,
  InfiniteQueryObserverOptions,
  InitialDataFunction,
  MutationObserverOptions,
  NonUndefinedGuard,
  QueryFunction,
  QueryKey,
  QueryObserverOptions,
  SkipToken,
} from '@tanstack/query-core'
import type { Effect, Exit, Redacted } from 'effect'

/** A JSON scalar accepted in key prefixes and canonical key payloads. */
export type JsonPrimitive = boolean | null | number | string

/** An immutable JSON value accepted in cache keys. */
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]

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
}

export type ConditionalQueryOptions<Data, Error, Selected, Key extends QueryKey> = QueryOptions<
  Data,
  Error,
  Selected,
  Key,
  QueryFunction<Data, Key> | SkipToken
>

export type InputQueryOptions<
  Input,
  Data,
  Error,
  Selected,
  Key extends QueryKey,
  SkippedKey extends QueryKey,
> = unknown extends Input
  ? ConditionalQueryOptions<Data, Error, Selected, Key | SkippedKey>
  : [Input] extends [SkipToken]
    ? QueryOptions<Data, Error, Selected, SkippedKey, SkipToken>
    : SkipToken extends Input
      ? ConditionalQueryOptions<Data, Error, Selected, Key | SkippedKey>
      : QueryOptions<Data, Error, Selected, Key>

/** Owns unary query inference; adapters supply their request, data, error, and key types. */
export type UnaryQueryBuilder<
  Input,
  Data,
  Error,
  Key extends QueryKey,
  SkippedKey extends QueryKey,
  AdapterOptions = unknown,
  Inputless extends boolean = void extends Input ? true : false,
> = Inputless extends true
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
      <Selected = Data, ActualInput extends SkipToken = SkipToken>(
        options: WithDefinedInitialData<
          QueryInput<
            Data,
            Error,
            Selected,
            InputQueryOptions<ActualInput, Data, Error, Selected, Key, SkippedKey>['queryKey'],
            AdapterOptions
          >,
          Data
        > & { readonly input: ActualInput },
      ): WithDefinedInitialData<
        InputQueryOptions<ActualInput, Data, Error, Selected, Key, SkippedKey>,
        Data
      >
      <Selected = Data, ActualInput extends SkipToken = SkipToken>(
        options: WithUndefinedInitialData<
          QueryInput<
            Data,
            Error,
            Selected,
            InputQueryOptions<ActualInput, Data, Error, Selected, Key, SkippedKey>['queryKey'],
            AdapterOptions
          >,
          Data
        > & { readonly input: ActualInput },
      ): InputQueryOptions<ActualInput, Data, Error, Selected, Key, SkippedKey>
      <Selected = Data, ActualInput extends Input = Input>(
        options: WithDefinedInitialData<
          QueryInput<
            Data,
            Error,
            Selected,
            InputQueryOptions<ActualInput, Data, Error, Selected, Key, SkippedKey>['queryKey'],
            AdapterOptions
          >,
          Data
        > & { readonly input: ActualInput },
      ): WithDefinedInitialData<
        InputQueryOptions<ActualInput, Data, Error, Selected, Key, SkippedKey>,
        Data
      >
      <Selected = Data, ActualInput extends Input = Input>(
        options: WithUndefinedInitialData<
          QueryInput<
            Data,
            Error,
            Selected,
            InputQueryOptions<ActualInput, Data, Error, Selected, Key, SkippedKey>['queryKey'],
            AdapterOptions
          >,
          Data
        > & { readonly input: ActualInput },
      ): InputQueryOptions<ActualInput, Data, Error, Selected, Key, SkippedKey>
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
}

/** Tags concrete infinite keys with their cached pages and inferred page parameter. */
export type InfiniteQueryKey<
  Input,
  Data,
  Error,
  OperationKey extends readonly JsonValue[],
  PageParam = unknown,
  Inputless extends boolean = void extends Input ? true : false,
> = DataTag<
  Inputless extends true ? OperationKey : readonly [...OperationKey, JsonValue],
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
  Inputless extends boolean,
> = InfiniteInput<
  Data,
  Error,
  Selected,
  InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam, Inputless>,
  PageParam,
  AdapterOptions
> &
  (Inputless extends true ? unknown : { readonly input: (pageParam: PageParam) => Input })

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
  Inputless extends boolean = void extends Input ? true : false,
> = {
  <PageParam, Selected = InfiniteData<Data, PageParam>>(
    options: WithDefinedInitialData<
      MappedInfiniteInput<
        Input,
        Data,
        Error,
        OperationKey,
        Selected,
        PageParam,
        AdapterOptions,
        Inputless
      >,
      InfiniteData<Data, PageParam>
    >,
  ): WithDefinedInitialData<
    InfiniteOptions<
      Data,
      Error,
      Selected,
      InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam, Inputless>,
      PageParam
    >,
    InfiniteData<Data, PageParam>
  >
  <PageParam, Selected = InfiniteData<Data, PageParam>>(
    options: WithUndefinedInitialData<
      MappedInfiniteInput<
        Input,
        Data,
        Error,
        OperationKey,
        Selected,
        PageParam,
        AdapterOptions,
        Inputless
      >,
      InfiniteData<Data, PageParam>
    >,
  ): InfiniteOptions<
    Data,
    Error,
    Selected,
    InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam, Inputless>,
    PageParam
  >
} & (Inputless extends true
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
            InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam, Inputless> | OperationKey,
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
          InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam, Inputless> | OperationKey,
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
            InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam, Inputless> | OperationKey,
            PageParam,
            AdapterOptions
          >,
          InfiniteData<Data, PageParam>
        > & { readonly input: ((pageParam: PageParam) => Input) | SkipToken },
      ): ConditionalInfiniteOptions<
        Data,
        Error,
        Selected,
        InfiniteQueryKey<Input, Data, Error, OperationKey, PageParam, Inputless> | OperationKey,
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
