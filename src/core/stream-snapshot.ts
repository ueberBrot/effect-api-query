import { CancelledError } from '@tanstack/query-core'
import type {
  DefaultError,
  QueryClient,
  QueryExecuteOptions,
  QueryFunction,
  QueryKey,
} from '@tanstack/query-core'
import { Predicate } from 'effect'

export interface StreamSnapshotOptions {
  readonly mode?: 'fresh' | 'cached'
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

const validateSnapshotControls = (
  options: Pick<QueryExecuteOptions, 'queryHash' | 'queryKeyHashFn'>,
  timeoutMs: number,
): void => {
  if (Object.hasOwn(options, 'queryHash') || Object.hasOwn(options, 'queryKeyHashFn')) {
    throw new TypeError('Stream snapshots inherit hashing from QueryClient defaults')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new RangeError('timeoutMs must be positive and at most 2147483647')
  }
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
    readonly queryHash?: never
    readonly queryKeyHashFn?: never
  },
  { mode = 'fresh', signal, timeoutMs = 10_000 }: StreamSnapshotOptions = {},
): Promise<TData> => {
  signal?.throwIfAborted()
  validateSnapshotControls(options, timeoutMs)
  if (!Predicate.isFunction(options.queryFn)) {
    throw new TypeError('Stream snapshots require a callable query function')
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
  const { queryHash } = queryClient.defaultQueryOptions(options)
  let published = false
  let started = false
  let executionSignal: AbortSignal | undefined
  let failed = false
  let failure: unknown
  let cleanup = Promise.resolve()
  let cancellation: Promise<void> | undefined
  const cancel = async () => {
    cancellation ??= queryClient.cancelQueries({ exact: true, queryKey: options.queryKey })
    await cancellation
  }
  let ready!: () => void
  let rejectPublication!: (reason: AbortSignal['reason']) => void
  const publication = new Promise<void>((resolve, reject) => {
    ready = resolve
    rejectPublication = reject
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
  const onAbort = () => {
    rejectPublication(signal?.reason)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    rejectPublication(new DOMException('Stream snapshot timed out', 'TimeoutError'))
  }, timeoutMs)
  let result: TData
  try {
    void queryClient.invalidateQueries({
      exact: true,
      queryKey: options.queryKey,
      refetchType: 'none',
    })
    signal?.throwIfAborted()
    const fetching = queryClient.query({
      ...options,
      staleTime: 0,
      initialDataUpdatedAt: 0,
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
