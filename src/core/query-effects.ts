/* oxlint-disable eslint/max-classes-per-file */
import { noop } from "@tanstack/query-core";
import type {
  DefaultError,
  InferDataFromTag,
  InvalidateOptions,
  InvalidateQueryFilters,
  QueryClient,
  QueryExecuteOptions,
  QueryKey,
  SetDataOptions,
  Updater,
} from "@tanstack/query-core";
import { Context, Effect } from "effect";

type QueryEffectFetchOptions<
  A,
  E = DefaultError,
  K extends QueryKey = QueryKey,
> = Omit<QueryExecuteOptions<A, E, A, A, K>, "select">;

type QueryEffectEnsureOptions<
  A,
  E = DefaultError,
  K extends QueryKey = QueryKey,
> = QueryEffectFetchOptions<A, E, K> & {
  revalidateIfStale?: boolean;
};

const identity = <A>(data: A): A => data;

const prepareQueryOptions = <
  A,
  E = DefaultError,
  K extends QueryKey = QueryKey,
>(
  options: QueryEffectFetchOptions<A, E, K>,
  staleTime?: QueryExecuteOptions<A, E, A, A, K>["staleTime"]
): QueryExecuteOptions<A, E, A, A, K> => {
  const next: QueryExecuteOptions<A, E, A, A, K> = {
    ...options,
    select: identity,
  };
  if (staleTime !== undefined) {
    next.staleTime = staleTime;
  }
  return next;
};

const hasCachedData = <A, E, K extends QueryKey>(
  client: QueryClient,
  options: QueryExecuteOptions<A, E, A, A, K>
): boolean => {
  const { queryHash } = client.defaultQueryOptions(options);
  return (
    client.getQueryCache().get(queryHash)?.state.data !== undefined ||
    options.initialData !== undefined
  );
};

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

const getData =
  /* @__PURE__ */
  Effect.fnUntraced(function* getData<
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

const setData =
  /* @__PURE__ */
  Effect.fnUntraced(function* setData<
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

const fetch =
  /* @__PURE__ */
  Effect.fnUntraced(function* fetch<
    A,
    E = DefaultError,
    K extends QueryKey = QueryKey,
  >(
    options: QueryEffectFetchOptions<A, E, K>
  ): Effect.fn.Return<A, QueryClientOperationError, QueryClientService> {
    const client = yield* QueryClientService;
    return yield* wait<A>(
      async () => await client.query(prepareQueryOptions(options))
    );
  });

const ensure =
  /* @__PURE__ */
  Effect.fnUntraced(function* ensure<
    A,
    E = DefaultError,
    K extends QueryKey = QueryKey,
  >(
    options: QueryEffectEnsureOptions<A, E, K>
  ): Effect.fn.Return<A, QueryClientOperationError, QueryClientService> {
    const client = yield* QueryClientService;
    return yield* wait<A>(async () => {
      const { revalidateIfStale, ...rest } = options;
      const fetchOptions = prepareQueryOptions(rest);
      const shouldRevalidate =
        revalidateIfStale === true && hasCachedData(client, fetchOptions);
      const data = await client.query(prepareQueryOptions(rest, "static"));
      if (shouldRevalidate) {
        void client.query(fetchOptions).catch(noop);
      }
      return data;
    });
  });

const invalidate =
  /* @__PURE__ */
  Effect.fnUntraced(function* invalidate(
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
