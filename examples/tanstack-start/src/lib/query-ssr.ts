import { defaultShouldDehydrateQuery } from '@tanstack/react-query'
import type { QueryExecuteOptions, QueryClient, QueryKey } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

/**
 * Captures the first successful cache snapshot from an open stream, then interrupts its server
 * subscription so route loading and dehydration can finish.
 */
export const fetchStreamSnapshot = async <TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: QueryExecuteOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>,
): Promise<TData> => {
  // Start first so an earlier cached error or reset snapshot cannot settle this request.
  const fetching = queryClient.query(options)
  let stopWatching: (() => void) | undefined
  // The callback/event API needs a Promise bridge in the ES2022 target.
  // oxlint-disable-next-line promise/avoid-new
  const snapshotReady = new Promise<void>((resolve) => {
    const inspect = () => {
      const state = queryClient.getQueryState<TData, TError, TQueryKey>(options.queryKey)
      if (state?.status === 'success') {
        resolve()
      }
    }
    stopWatching = queryClient.getQueryCache().subscribe(inspect)
    inspect()
  })
  try {
    // Cancellation can restore pending state; the fetch promise owns terminal failures.
    await Promise.race([snapshotReady, fetching])
    await queryClient.cancelQueries({ exact: true, queryKey: options.queryKey })
    return await fetching
  } finally {
    stopWatching?.()
  }
}

/** Configures QueryClient hydration, including Effect Schema class serialization. */
export const setupQuerySsr = (router: AnyRouter, queryClient: QueryClient): void => {
  setupRouterSsrQueryIntegration({
    dehydrateOptions: {
      // Query cache data is opaque; structuredClone preserves the serialization boundary.
      // oxlint-disable-next-line anti-slop/no-unknown-parameters
      serializeData: (data: unknown) => structuredClone(data),
      shouldDehydrateQuery: defaultShouldDehydrateQuery,
    },
    queryClient,
    router,
  })
}
