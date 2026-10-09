import { CancelledError } from '@tanstack/query-core'
import type {
  DefaultError,
  QueryClient,
  QueryExecuteOptions,
  QueryFunction,
  QueryKey,
} from '@tanstack/query-core'

export interface StreamSnapshotOptions {
  readonly mode?: 'fresh' | 'cached'
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export const fetchStreamSnapshot = async <
  TQueryFnData,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  queryClient: QueryClient,
  options: QueryExecuteOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey> & {
    readonly queryFn: QueryFunction<TQueryFnData, TQueryKey>
  },
  { mode = 'fresh', signal, timeoutMs = 10_000 }: StreamSnapshotOptions = {},
): Promise<TData> => {
  signal?.throwIfAborted()
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new RangeError('timeoutMs must be positive and at most 2147483647')
  }
  const cache = queryClient.getQueryCache()
  const existing = cache.find({ exact: true, queryKey: options.queryKey })
  if (mode === 'cached' && existing?.state.status === 'success') {
    return await queryClient.query({ ...options, staleTime: 'static' })
  }
  if (
    existing !== undefined &&
    (existing.state.fetchStatus !== 'idle' || existing.getObserversCount() > 0)
  ) {
    throw new Error('Stream snapshots require an idle query without observers')
  }
  const queryHash = queryClient.defaultQueryOptions(options).queryHash
  let published = false
  let started = false
  let executionSignal: AbortSignal | undefined
  let failed = false
  let failure: unknown
  let cleanup = Promise.resolve()
  let cancellation: Promise<void> | undefined
  const cancel = () => {
    cancellation ??= queryClient.cancelQueries({ exact: true, queryKey: options.queryKey })
    return cancellation
  }
  let ready!: () => void
  let reject!: (error: unknown) => void
  const publication = new Promise<void>((resolve, rejectPublication) => {
    ready = resolve
    reject = rejectPublication
  })
  const stop = cache.subscribe((event) => {
    if (
      event.query.queryHash === queryHash &&
      event.type === 'updated' &&
      event.action.type === 'success' &&
      event.action.manual === true
    ) {
      published = true
      ready()
      void cancel()
    }
  })
  const onAbort = () => reject(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    reject(new DOMException('Stream snapshot timed out', 'TimeoutError'))
  }, timeoutMs)
  let result: TData
  try {
    const fetching = queryClient.query({
      ...options,
      staleTime: 0,
      queryFn: async (context) => {
        started = true
        failed = false
        failure = undefined
        executionSignal = context.signal
        let finished!: () => void
        cleanup = new Promise<void>((resolve) => {
          finished = resolve
        })
        try {
          return await options.queryFn(context)
        } catch (error) {
          failed = true
          failure = error
          throw error
        } finally {
          finished()
        }
      },
    })
    await Promise.race([publication, fetching])
    result = await fetching
    if (!published && (!started || executionSignal?.aborted === true)) {
      throw new CancelledError({ revert: true })
    }
  } finally {
    stop()
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    await cancel()
    await cleanup
  }
  if (failed) {
    throw failure
  }
  return result
}
