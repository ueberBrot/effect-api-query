import {
  defaultShouldDehydrateQuery,
  type QueryExecuteOptions,
  hydrate as hydrateQueryClient,
  type DehydratedState,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

interface DehydratedRouterQueryState {
  readonly dehydratedQueryClient?: DehydratedState
  readonly queryStream: ReadableStream<DehydratedState>
}

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
  let stopWatching = () => {}
  const snapshotReady = new Promise<void>((resolve) => {
    const inspect = () => {
      const state = queryClient.getQueryState<TData, TError, TQueryKey>(options.queryKey)
      if (state?.status === 'success') resolve()
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
    stopWatching()
  }
}

/** Configures QueryClient hydration, including Effect Schema class serialization. */
export const setupQuerySsr = <TRouter extends AnyRouter>(
  router: TRouter,
  queryClient: QueryClient,
): void => {
  const originalHydrate = router.options.hydrate

  setupRouterSsrQueryIntegration({
    dehydrateOptions: {
      serializeData: (data) => structuredClone(data),
      shouldDehydrateQuery: defaultShouldDehydrateQuery,
    },
    queryClient,
    router,
  })

  if (router.isServer) return

  // The current mature helper hydrates the terminal stream value before checking `done`.
  // Keep its provider and redirect integration, but read its dehydrated stream safely.
  router.options.hydrate = async (dehydrated: DehydratedRouterQueryState) => {
    await originalHydrate?.(dehydrated)
    if (dehydrated.dehydratedQueryClient !== undefined) {
      hydrateQueryClient(queryClient, dehydrated.dehydratedQueryClient)
    }

    const reader = dehydrated.queryStream.getReader()
    const hydrateNext = async (): Promise<void> => {
      const next = await reader.read()
      if (next.done) return
      hydrateQueryClient(queryClient, next.value)
      await hydrateNext()
    }
    void hydrateNext().catch((error: unknown) => {
      console.error('Error reading query stream:', error)
    })
  }
}
