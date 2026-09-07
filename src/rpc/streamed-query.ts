import { experimental_streamedQuery, type QueryFunctionContext } from '@tanstack/query-core'
import { Cause, Exit, Stream } from 'effect'

import type { StreamingOperation } from '../core/operation'
import type { RunPromiseExit } from '../core/types'
import {
  EffectRpcQueryConfigError,
  EffectRpcQueryEmptyStreamError,
  EffectRpcQueryError,
} from './errors'
import type { StreamRefetchMode, StreamingRpcOptions } from './types'

type StreamQueryPolicy =
  | {
      readonly maxChunks?: number
      readonly _tag: 'Accumulated'
      readonly refetchMode?: StreamRefetchMode
    }
  | { readonly _tag: 'Live' }

export interface RpcStreamInvocation {
  readonly tag: string
  readonly invoke: (
    input: unknown,
    options?: StreamingRpcOptions,
  ) => Stream.Stream<unknown, unknown, unknown>
}

interface MakeStreamQueryOptions {
  readonly rpcOptions: StreamingRpcOptions | undefined
  readonly input: unknown
  readonly policy: StreamQueryPolicy
  readonly rpc: RpcStreamInvocation
  readonly runPromiseExit: RunPromiseExit<unknown>
}

const abortableAsyncIterable = <A>(
  source: AsyncIterable<A>,
  signal: AbortSignal,
): AsyncIterable<A> => ({
  [Symbol.asyncIterator]() {
    const iterator = source[Symbol.asyncIterator]()
    let closePromise: Promise<IteratorResult<A>> | undefined
    const detach = () => signal.removeEventListener('abort', onAbort)
    const close = () => {
      closePromise ??= (async () => {
        try {
          return (
            (await iterator.return?.()) ?? ({ done: true, value: undefined } as IteratorResult<A>)
          )
        } finally {
          detach()
        }
      })()
      return closePromise
    }
    const onAbort = () => {
      void close().catch(() => undefined)
    }
    signal.addEventListener('abort', onAbort, { once: true })

    return {
      async next() {
        if (signal.aborted) return close()
        try {
          const result = await iterator.next()
          if (result.done) detach()
          return result
        } catch (cause) {
          detach()
          throw cause
        }
      },
      return: close,
      async throw(cause?: unknown) {
        detach()
        if (iterator.throw !== undefined) return iterator.throw(cause)
        await close()
        throw cause
      },
    }
  },
})

const requireFirstValue = <A>(source: AsyncIterable<A>, rpcTag: string): AsyncIterable<A> => ({
  [Symbol.asyncIterator]() {
    const iterator = source[Symbol.asyncIterator]()
    let emitted = false
    return {
      async next() {
        const result = await iterator.next()
        if (result.done && !emitted) throw new EffectRpcQueryEmptyStreamError(rpcTag)
        emitted = true
        return result
      },
      return: (value?: unknown) =>
        iterator.return?.(value) ?? Promise.resolve({ done: true, value: undefined }),
      async throw(cause?: unknown) {
        if (iterator.throw !== undefined) return iterator.throw(cause)
        await iterator.return?.()
        throw cause
      },
    }
  },
})

/** Adapts one Effect stream invocation to an accumulated or latest-value Query Core function. */
const makeStreamQuery = ({
  input,
  policy,
  rpc,
  rpcOptions,
  runPromiseExit,
}: MakeStreamQueryOptions) => {
  const operation = policy._tag === 'Live' ? 'live' : 'streamed'
  const streamFn = async ({ signal }: { readonly signal: AbortSignal }) => {
    const stream = rpc.invoke(input, rpcOptions).pipe(
      Stream.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) => Stream.fail(new EffectRpcQueryError(rpc.tag, operation, cause)),
      ),
    )
    // Capture the runner's Context so iterator pulls use the caller-owned runtime.
    const exit = await runPromiseExit(Stream.toAsyncIterableEffect(stream), { signal })
    if (Exit.isFailure(exit)) throw new EffectRpcQueryError(rpc.tag, operation, exit.cause)
    const iterable = abortableAsyncIterable(exit.value, signal)
    return policy._tag === 'Live' ? requireFirstValue(iterable, rpc.tag) : iterable
  }

  if (policy._tag === 'Live') {
    return experimental_streamedQuery({
      initialValue: undefined,
      reducer: (_latest: unknown, value: unknown) => value,
      streamFn,
    })
  }

  const { maxChunks, refetchMode = 'reset' } = policy
  if (maxChunks === undefined) return experimental_streamedQuery({ refetchMode, streamFn })

  return async (context: QueryFunctionContext) => {
    const reset =
      refetchMode === 'reset' &&
      context.client.getQueryCache().find({ queryKey: context.queryKey, exact: true })?.isFetched()
    let emitted = false
    const queryFn = experimental_streamedQuery({
      initialValue: [] as unknown[],
      reducer: (values: unknown[], value: unknown) => {
        // Query Core restores initialData on reset; a refetch starts a fresh accumulation.
        const history = reset && !emitted ? [] : values
        emitted = true
        return [...history.slice(Math.max(0, history.length + 1 - maxChunks)), value]
      },
      refetchMode,
      streamFn,
    })
    const result = await queryFn(context)
    return reset && !emitted ? [] : result
  }
}

/** Owns policy validation and execution for both accumulated and live queries. */
export const createStreamPreparation =
  (rpc: RpcStreamInvocation): StreamingOperation['prepareStream'] =>
  (options, operation, runPromiseExit, requestOptions) => {
    const refetchMode = options['refetchMode'] as StreamRefetchMode | undefined
    delete options['refetchMode']
    const maxChunks = options['maxChunks'] as number | undefined
    delete options['maxChunks']
    // Preparation also runs for skipped queries; invalid policy fails synchronously.
    if (maxChunks !== undefined && (!Number.isSafeInteger(maxChunks) || maxChunks <= 0)) {
      throw new EffectRpcQueryConfigError(
        'InvalidMaxChunks',
        'maxChunks must be a positive safe integer',
        { rpcTag: rpc.tag },
      )
    }
    return (input) =>
      makeStreamQuery({
        input,
        rpcOptions: requestOptions as StreamingRpcOptions | undefined,
        policy:
          operation === 'live'
            ? { _tag: 'Live' }
            : {
                _tag: 'Accumulated',
                ...(refetchMode === undefined ? {} : { refetchMode }),
                ...(maxChunks === undefined ? {} : { maxChunks }),
              },
        rpc,
        runPromiseExit,
      })
  }
