// Keep the native v5 fetch/ensure APIs for the supported Query Core floor.
/* oxlint-disable typescript/no-deprecated */
/* oxlint-disable eslint/max-classes-per-file */
import type {
  DefaultError,
  EnsureQueryDataOptions,
  FetchQueryOptions,
  InferDataFromTag,
  InvalidateOptions,
  InvalidateQueryFilters,
  QueryClient,
  QueryKey,
  SetDataOptions,
  Updater,
} from "@tanstack/query-core";
import { Context, Effect } from "effect";

/** The existing application cache; providing it does not acquire or dispose resources. */
export class QueryClientService extends Context.Service<
  QueryClientService,
  QueryClient
>()("@ueberbrot/effect-api-query/QueryClientService") {}

/** A native QueryClient failure retaining the exact rejected value. */
export class QueryClientOperationError extends Error {
  readonly _tag = "QueryClientOperationError";
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super("QueryClient operation failed", { cause });
    this.name = "QueryClientOperationError";
    this.cause = cause;
  }
}

const wait = <A>(
  run: () => Promise<A>
): Effect.Effect<A, QueryClientOperationError> =>
  Effect.tryPromise({
    // QueryClient owns shared execution; interruption stops only this wait.
    try: run,
    // Promise rejection carries no proof of the current options' declared error type.
    catch: (cause) => new QueryClientOperationError(cause),
  });

const getData = Effect.fnUntraced(function* getData<
  A = unknown,
  K extends QueryKey = QueryKey,
>(
  key: K
): Effect.fn.Return<
  InferDataFromTag<A, K> | undefined,
  QueryClientOperationError,
  QueryClientService
> {
  const client = yield* QueryClientService;
  return yield* Effect.try({
    try: () => client.getQueryData<A, K>(key),
    catch: (cause) => new QueryClientOperationError(cause),
  });
});

const setData = Effect.fnUntraced(function* setData<
  A = unknown,
  K extends QueryKey = QueryKey,
>(
  key: K,
  updater: Updater<
    NoInfer<InferDataFromTag<A, K>> | undefined,
    NoInfer<InferDataFromTag<A, K>> | undefined
  >,
  options?: SetDataOptions
): Effect.fn.Return<
  InferDataFromTag<A, K> | undefined,
  QueryClientOperationError,
  QueryClientService
> {
  const client = yield* QueryClientService;
  return yield* Effect.try({
    try: () => client.setQueryData<A, K>(key, updater, options),
    catch: (cause) => new QueryClientOperationError(cause),
  });
});

const fetch = Effect.fnUntraced(function* fetch<
  A,
  E = DefaultError,
  K extends QueryKey = QueryKey,
>(
  options: FetchQueryOptions<A, E, A, K>
): Effect.fn.Return<A, QueryClientOperationError, QueryClientService> {
  const client = yield* QueryClientService;
  return yield* wait<A>(async () => await client.fetchQuery(options));
});

const ensure = Effect.fnUntraced(function* ensure<
  A,
  E = DefaultError,
  K extends QueryKey = QueryKey,
>(
  options: EnsureQueryDataOptions<A, E, A, K>
): Effect.fn.Return<A, QueryClientOperationError, QueryClientService> {
  const client = yield* QueryClientService;
  return yield* wait<A>(async () => await client.ensureQueryData(options));
});

const invalidate = Effect.fnUntraced(function* invalidate(
  filters?: InvalidateQueryFilters,
  options?: InvalidateOptions
): Effect.fn.Return<void, QueryClientOperationError, QueryClientService> {
  const client = yield* QueryClientService;
  // Broad filters may match unrelated error types; never claim a typed execution error.
  return yield* Effect.tryPromise({
    try: async () => {
      await client.invalidateQueries(filters, options);
    },
    catch: (cause) => new QueryClientOperationError(cause),
  });
});

/** Lazy native cache operations. Interruption stops only this caller's wait. */
export const queryEffects = { getData, setData, fetch, ensure, invalidate };
