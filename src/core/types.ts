import type {
  InfiniteQueryObserverOptions,
  InitialDataFunction,
  MutationObserverOptions,
  NonUndefinedGuard,
  QueryFunction,
  QueryKey,
  QueryKeyHashFunction,
  QueryObserverOptions,
} from '@tanstack/query-core'
import type { Effect, Exit, Redacted } from 'effect'

/** A JSON scalar accepted in key prefixes and canonical key payloads. */
export type JsonPrimitive = boolean | null | number | string

/** An immutable JSON value accepted in cache keys. */
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]

/**
 * The value cached for a successful query.
 *
 * TanStack rejects `undefined` query data, so possible `undefined` values become
 * `null`. Mutation results keep the success type unchanged.
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

export type MutationOptions<Data, Error, Input, Key extends QueryKey, OnMutateResult> = Omit<
  MutationObserverOptions<Data, Error, Input, OnMutateResult>,
  OwnedMutationOption
> & {
  readonly mutationFn: (variables: Input) => Promise<Data>
  readonly mutationKey: Key
}

export type HasSeenType<A, Seen> = Seen extends unknown
  ? (<T>() => T extends A ? 1 : 2) extends <T>() => T extends Seen ? 1 : 2
    ? true
    : false
  : never

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
