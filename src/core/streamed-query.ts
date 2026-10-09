import { experimental_streamedQuery } from '@tanstack/query-core'
import type { QueryFunctionContext } from '@tanstack/query-core'
import { Exit, Stream } from 'effect'
import type { Cause } from 'effect'

import type { RunPromiseExit } from './types'

export type StreamQueryPolicy =
  | {
      readonly maxChunks: number | undefined
      readonly _tag: 'Accumulated'
      readonly refetchMode: 'reset' | 'append' | 'replace'
    }
  | { readonly _tag: 'Live' }

export interface MakeStreamQueryOptions {
  readonly policy: StreamQueryPolicy
  readonly source: Stream.Stream<unknown, unknown, unknown>
  readonly executionError: (cause: Cause.Cause<unknown>) => Error
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
      void close().catch(detach)
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
  emptyError,
  runPromiseExit,
}: MakeStreamQueryOptions) => {
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
    return experimental_streamedQuery({
      initialValue: null,
      reducer: (_latest: unknown, value: unknown) => (value === undefined ? null : value),
      streamFn,
    })
  }

  const { maxChunks, refetchMode } = policy
  return async (context: QueryFunctionContext) => {
    const reset =
      refetchMode === 'reset' &&
      context.client
        .getQueryCache()
        .find({ queryKey: context.queryKey, exact: true })
        ?.isFetched() === true
    let emitted = false
    const initialValue: unknown[] = []
    const queryFn = experimental_streamedQuery({
      initialValue,
      reducer: (values: unknown[], value: unknown) => {
        const history = reset && !emitted ? [] : values
        emitted = true
        return [
          ...(maxChunks === undefined
            ? history
            : history.slice(Math.max(0, history.length + 1 - maxChunks))),
          value,
        ]
      },
      refetchMode,
      streamFn,
    })
    const result = await queryFn(context)
    return reset && !emitted ? [] : result
  }
}
