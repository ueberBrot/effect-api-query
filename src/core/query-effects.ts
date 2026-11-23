/* oxlint-disable eslint/max-classes-per-file */
import type {
  CancelOptions,
  DefaultError,
  InferDataFromTag,
  InferErrorFromTag,
  InfiniteData,
  InfiniteQueryExecuteOptions,
  InvalidateOptions,
  InvalidateQueryFilters,
  QueryClient,
  QueryExecuteOptions,
  QueryFilters,
  QueryKey,
  QueryState,
  RefetchOptions,
  RefetchQueryFilters,
  ResetOptions,
  SetDataOptions,
  SkipToken,
  Updater,
} from "@tanstack/query-core";
import { Context, Data, Effect } from "effect";

import { fetchStreamSnapshot } from "./stream-snapshot";
import type {
  StreamSnapshotOptions,
  StreamSnapshotQueryOptions,
} from "./stream-snapshot";

type ExecutableOptions<Options extends { queryFn?: unknown }> = Options & {
  readonly queryFn?: Exclude<Options["queryFn"], SkipToken>;
};

/** The existing application cache; providing it does not acquire or dispose resources. */
export class QueryClientService extends Context.Service<
  QueryClientService,
  QueryClient
>()("@ueberbrot/effect-api-query/QueryClientService") {}

/** A native QueryClient failure retaining the exact rejected value. */
export class QueryClientOperationError extends Data.TaggedError(
  "QueryClientOperationError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {
  constructor(cause: unknown) {
    super({
      cause,
      message: "QueryClient operation failed",
    });
  }
}

const wrapError = (cause: unknown) => new QueryClientOperationError(cause);

type CacheEffect<A> = Effect.Effect<
  A,
  QueryClientOperationError,
  QueryClientService
>;

const wait = <A>(run: (client: QueryClient) => Promise<A>): CacheEffect<A> =>
  QueryClientService.pipe(
    Effect.flatMap((client) =>
      Effect.tryPromise({
        try: async () => await run(client),
        catch: wrapError,
      })
    )
  );

const attempt = <A>(run: (client: QueryClient) => A): CacheEffect<A> =>
  QueryClientService.pipe(
    Effect.flatMap((client) =>
      Effect.try({ try: () => run(client), catch: wrapError })
    )
  );

const getData = <A = unknown, K extends QueryKey = QueryKey>(
  key: K
): CacheEffect<InferDataFromTag<A, K> | undefined> =>
  attempt((client) => client.getQueryData<A, K>(key));

const setData = <A = unknown, K extends QueryKey = QueryKey>(
  key: K,
  updater: Updater<
    NoInfer<InferDataFromTag<A, K>> | undefined,
    NoInfer<InferDataFromTag<A, K>> | undefined
  >,
  options?: SetDataOptions
): CacheEffect<InferDataFromTag<A, K> | undefined> =>
  attempt((client) => client.setQueryData<A, K>(key, updater, options));

const query = <
  A,
  E = DefaultError,
  Data = A,
  CacheData = A,
  K extends QueryKey = QueryKey,
  PageParam = never,
>(
  options: ExecutableOptions<
    QueryExecuteOptions<A, E, Data, CacheData, K, PageParam>
  >
): CacheEffect<Data> =>
  wait(async (client) => await client.query({ ...options }));

const infiniteQuery = <
  A,
  E = DefaultError,
  Data = InfiniteData<A>,
  K extends QueryKey = QueryKey,
  PageParam = unknown,
>(
  options: ExecutableOptions<
    InfiniteQueryExecuteOptions<A, E, Data, K, PageParam>
  >
): CacheEffect<
  Data[] extends InfiniteData<A>[] ? InfiniteData<A, PageParam> : Data
> => wait(async (client) => await client.infiniteQuery({ ...options }));

const prefetch = <
  A,
  E = DefaultError,
  Data = A,
  CacheData = A,
  K extends QueryKey = QueryKey,
  PageParam = never,
>(
  options: ExecutableOptions<
    QueryExecuteOptions<A, E, Data, CacheData, K, PageParam>
  >
): Effect.Effect<void, never, QueryClientService> =>
  Effect.ignore(query(options));

const prefetchInfinite = <
  A,
  E = DefaultError,
  Data = InfiniteData<A>,
  K extends QueryKey = QueryKey,
  PageParam = unknown,
>(
  options: ExecutableOptions<
    InfiniteQueryExecuteOptions<A, E, Data, K, PageParam>
  >
): Effect.Effect<void, never, QueryClientService> =>
  Effect.ignore(infiniteQuery(options));

const streamSnapshot = <
  A,
  E = DefaultError,
  Data = A,
  K extends QueryKey = QueryKey,
>(
  options: StreamSnapshotQueryOptions<A, E, Data, K>,
  controls?: StreamSnapshotOptions
): CacheEffect<Data> =>
  QueryClientService.pipe(
    Effect.flatMap((client) =>
      Effect.tryPromise({
        try: async (signal) =>
          await fetchStreamSnapshot(client, options, {
            ...controls,
            signal:
              controls?.signal === undefined
                ? signal
                : AbortSignal.any([signal, controls.signal]),
          }),
        catch: wrapError,
      })
    )
  );

const getState = <A = unknown, E = DefaultError, K extends QueryKey = QueryKey>(
  key: K
): CacheEffect<
  QueryState<InferDataFromTag<A, K>, InferErrorFromTag<E, K>> | undefined
> => attempt((client) => client.getQueryState<A, E, K>(key));

const isFetching = (
  filters?: Omit<QueryFilters, "fetchStatus">
): CacheEffect<number> => attempt((client) => client.isFetching(filters));

const invalidate = <K extends QueryKey = QueryKey>(
  filters?: InvalidateQueryFilters<K>,
  options?: InvalidateOptions
): CacheEffect<void> =>
  wait(async (client) => {
    await client.invalidateQueries(filters, options);
  });

const refetch = <K extends QueryKey = QueryKey>(
  filters?: RefetchQueryFilters<K>,
  options?: RefetchOptions
): CacheEffect<void> =>
  wait(async (client) => {
    await client.refetchQueries(filters, options);
  });

const cancel = <K extends QueryKey = QueryKey>(
  filters?: QueryFilters<K>,
  options?: CancelOptions
): CacheEffect<void> =>
  wait(async (client) => {
    await client.cancelQueries(filters, options);
  });

const remove = <K extends QueryKey = QueryKey>(
  filters?: QueryFilters<K>
): CacheEffect<void> =>
  attempt((client) => {
    client.removeQueries(filters);
  });

const reset = <K extends QueryKey = QueryKey>(
  filters?: QueryFilters<K>,
  options?: ResetOptions
): CacheEffect<void> =>
  wait(async (client) => {
    await client.resetQueries(filters, options);
  });

/** Lazy native cache operations. Interruption stops the caller's wait and aborts an exclusive stream snapshot. */
export const queryEffects = {
  query,
  infiniteQuery,
  prefetch,
  prefetchInfinite,
  streamSnapshot,
  getData,
  setData,
  getState,
  isFetching,
  invalidate,
  refetch,
  cancel,
  remove,
  reset,
};
