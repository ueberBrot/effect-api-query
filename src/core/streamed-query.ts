import { experimental_streamedQuery, hashKey } from '@tanstack/query-core'
import type { QueryFunctionContext } from '@tanstack/query-core'
import { Exit, Predicate, Stream } from 'effect'
import type { Cause } from 'effect'

import type { RunPromiseExit, StreamRefetchMode } from './types'

export type StreamQueryPolicy =
  | {
      readonly maxChunks: number | undefined
      readonly _tag: 'Accumulated'
      readonly refetchMode: StreamRefetchMode
    }
  | { readonly _tag: 'Live' }

export const prepareStreamPolicy = (
  options: Record<string, unknown>,
  operation: 'live' | 'streamed',
  invalid: (code: 'InvalidMaxChunks' | 'InvalidRefetchMode', message: string) => Error,
) => {
  let policy: StreamQueryPolicy
  if (operation === 'streamed') {
    const { maxChunks, refetchMode = 'reset' } = options
    if (
      maxChunks !== undefined &&
      (!Predicate.isNumber(maxChunks) || !Number.isSafeInteger(maxChunks) || maxChunks <= 0)
    ) {
      throw invalid('InvalidMaxChunks', 'maxChunks must be a positive safe integer')
    }
    if (refetchMode !== 'reset' && refetchMode !== 'append' && refetchMode !== 'replace') {
      throw invalid('InvalidRefetchMode', 'refetchMode must be reset, append, or replace')
    }
    policy = { _tag: 'Accumulated', maxChunks, refetchMode }
  } else {
    policy = { _tag: 'Live' }
  }
  delete options['refetchMode']
  delete options['maxChunks']
  return {
    policy,
    history:
      policy._tag === 'Live'
        ? undefined
        : { maxChunks: policy.maxChunks ?? null, refetchMode: policy.refetchMode },
  }
}

export interface MakeStreamQueryOptions {
  readonly policy: StreamQueryPolicy
  readonly source: Stream.Stream<unknown, unknown, unknown>
  readonly executionError: (cause: Cause.Cause<unknown>) => Error
  readonly unsupportedHash: () => Error
  readonly emptyError?: (() => Error) | undefined
  readonly runPromiseExit: RunPromiseExit<unknown>
}

const streamQueryIterable = <A>(
  source: AsyncIterable<A>,
  signal: AbortSignal,
  emptyError: (() => Error) | undefined,
): AsyncIterable<A> => ({
  [Symbol.asyncIterator]() {
    const iterator = source[Symbol.asyncIterator]()
    let closePromise: Promise<IteratorResult<A>> | undefined
    let emitted = false
    const detach = () => {
      // oxlint-disable-next-line eslint/no-use-before-define
      signal.removeEventListener('abort', onAbort)
    }
    const close = async () => {
      closePromise ??= (async () => {
        try {
          return (await iterator.return?.()) ?? { done: true, value: undefined }
        } finally {
          detach()
        }
      })()
      return closePromise
    }
    const onAbort = () => {
      // oxlint-disable-next-line promise/prefer-await-to-then
      void Promise.resolve().then(close).catch(detach)
    }
    signal.addEventListener('abort', onAbort, { once: true })

    return {
      async next() {
        let result: IteratorResult<A>
        if (signal.aborted) {
          result = await close()
        } else {
          try {
            result = await iterator.next()
          } catch (error) {
            detach()
            throw error
          }
        }
        if (result.done === true) {
          detach()
          if (!emitted && emptyError !== undefined) {
            throw emptyError()
          }
        }
        emitted = true
        return result
      },
      return: close,
      async throw(cause?: unknown) {
        detach()
        if (iterator.throw !== undefined) {
          return await iterator.throw(cause)
        }
        await close()
        throw cause
      },
    }
  },
})

export const makeStreamQuery = ({
  policy,
  source,
  executionError,
  unsupportedHash,
  emptyError,
  runPromiseExit,
}: MakeStreamQueryOptions) => {
  const validateHash = ({ client, queryKey }: QueryFunctionContext) => {
    const { queryHash, queryKeyHashFn } = client.defaultQueryOptions({ queryKey })
    if (queryHash !== (queryKeyHashFn ?? hashKey)(queryKey)) {
      throw unsupportedHash()
    }
    const cache = client.getQueryCache()
    let currentFound = false
    let nativeHash: string | undefined
    for (const query of cache.getAll()) {
      if (query.queryHash === queryHash) {
        currentFound = true
        continue
      }
      if (query.options.queryKeyHashFn === queryKeyHashFn) {
        continue
      }
      if (currentFound) {
        try {
          nativeHash ??= hashKey(queryKey)
          if (hashKey(query.queryKey) !== nativeHash) {
            continue
          }
        } catch {
          continue
        }
      }
      if (query.queryHash === (query.options.queryKeyHashFn ?? hashKey)(queryKey)) {
        throw unsupportedHash()
      }
    }
    return cache.get(queryHash)
  }
  const streamFn = async ({ signal }: { readonly signal: AbortSignal }) => {
    const stream = source.pipe(
      Stream.catchCauseIf(
        () => !signal.aborted,
        (cause) => Stream.fail(executionError(cause)),
      ),
    )
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
    const exit = await runPromiseExit(Stream.toAsyncIterableEffect(stream), { signal })
    if (Exit.isFailure(exit)) {
      throw executionError(exit.cause)
    }
    return streamQueryIterable(exit.value, signal, policy._tag === 'Live' ? emptyError : undefined)
  }

  if (policy._tag === 'Live') {
    const queryFn = experimental_streamedQuery({
      initialValue: null,
      reducer: (_latest: unknown, value: unknown) => (value === undefined ? null : value),
      streamFn,
    })
    return async (context: QueryFunctionContext) => {
      validateHash(context)
      return await queryFn(context)
    }
  }

  const { maxChunks, refetchMode } = policy
  return async (context: QueryFunctionContext) => {
    const query = validateHash(context)
    const reset = refetchMode === 'reset' && query?.isFetched() === true
    let emitted = false
    const initialValue: unknown[] = []
    const queryFn = experimental_streamedQuery({
      initialValue,
      reducer: (values: unknown[], value: unknown) => {
        const history = reset && !emitted ? [] : values
        emitted = true
        if (maxChunks === undefined) {
          return [...history, value]
        }
        const start = Math.max(0, history.length + 1 - maxChunks)
        // oxlint-disable-next-line unicorn/no-new-array
        const next = new Array<unknown>(history.length + 1 - start)
        for (let index = start; index < history.length; index += 1) {
          next[index - start] = history[index]
        }
        next[next.length - 1] = value
        return next
      },
      refetchMode,
      streamFn,
    })
    const result = await queryFn(context)
    return reset && !emitted ? [] : result
  }
}
