import { experimental_streamedQuery } from '@tanstack/query-core'
import type { QueryFunctionContext } from '@tanstack/query-core'
import { Cause, Exit, Predicate, Stream } from 'effect'

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
    // This callback runs after the listener has been initialized below.
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
      // Abort listeners are synchronous; attach cleanup rejection handling immediately.
      // oxlint-disable-next-line promise/prefer-await-to-then
      void close().catch(() => {
        // The pending iterator pull or explicit return reports failures to Query Core.
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })

    return {
      async next() {
        if (signal.aborted) {
          return await close()
        }
        try {
          const result = await iterator.next()
          if (result.done === true) {
            detach()
          }
          return result
        } catch (error) {
          detach()
          throw error
        }
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

const requireFirstValue = <A>(source: AsyncIterable<A>, rpcTag: string): AsyncIterable<A> => ({
  [Symbol.asyncIterator]() {
    const iterator = source[Symbol.asyncIterator]()
    let emitted = false
    return {
      async next() {
        const result = await iterator.next()
        if (result.done === true && !emitted) {
          throw new EffectRpcQueryEmptyStreamError(rpcTag)
        }
        emitted = true
        return result
      },
      return: async (value?: unknown) =>
        iterator.return?.(value) ?? Promise.resolve({ done: true, value: undefined }),
      async throw(cause?: unknown) {
        if (iterator.throw !== undefined) {
          return await iterator.throw(cause)
        }
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
    // The injected runner provides the erased caller-owned service requirements.
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
    const exit = await runPromiseExit(Stream.toAsyncIterableEffect(stream), { signal })
    if (Exit.isFailure(exit)) {
      throw new EffectRpcQueryError(rpc.tag, operation, exit.cause)
    }
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
  if (maxChunks === undefined) {
    return experimental_streamedQuery({ refetchMode, streamFn })
  }

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
    // SAFETY: Public streamedOptions restricts this field to StreamRefetchMode;
    // the options copy changes neither its value nor its contract.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const refetchMode = options['refetchMode'] as StreamRefetchMode | undefined
    delete options['refetchMode']
    const { maxChunks } = options
    delete options['maxChunks']
    // Preparation also runs for skipped queries; invalid policy fails synchronously.
    if (
      maxChunks !== undefined &&
      (!Predicate.isNumber(maxChunks) || !Number.isSafeInteger(maxChunks) || maxChunks <= 0)
    ) {
      throw new EffectRpcQueryConfigError(
        'InvalidMaxChunks',
        'maxChunks must be a positive safe integer',
        { rpcTag: rpc.tag },
      )
    }
    const policy: StreamQueryPolicy =
      operation === 'live' ? { _tag: 'Live' } : { _tag: 'Accumulated' }
    if (policy._tag === 'Accumulated') {
      Object.assign(policy, refetchMode === undefined ? undefined : { refetchMode })
      Object.assign(policy, maxChunks === undefined ? undefined : { maxChunks })
    }
    // SAFETY: takeRpcOptions extracted this unchanged from the typed public options.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const rpcOptions = requestOptions as StreamingRpcOptions | undefined
    return (input) =>
      makeStreamQuery({
        input,
        rpcOptions,
        policy,
        rpc,
        runPromiseExit,
      })
  }
