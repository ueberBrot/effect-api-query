import { Predicate, Stream } from 'effect'

import type { StreamingOperation } from '../core/operation'
import { makeStreamQuery } from '../core/streamed-query'
import type { StreamQueryPolicy } from '../core/streamed-query'
import type { JsonValue } from '../core/types'
import {
  EffectRpcQueryConfigError,
  EffectRpcQueryEmptyStreamError,
  EffectRpcQueryError,
} from './errors'
import type { StreamingRpcOptions } from './types'

export interface RpcStreamInvocation {
  readonly tag: string
  readonly invoke: (
    input: unknown,
    options?: StreamingRpcOptions,
  ) => Stream.Stream<unknown, unknown, unknown>
}

const accumulatedPolicy = (
  rpcTag: string,
  options: Record<string, unknown>,
): Extract<StreamQueryPolicy, { readonly _tag: 'Accumulated' }> => {
  const { maxChunks, refetchMode = 'reset' } = options
  if (
    maxChunks !== undefined &&
    (!Predicate.isNumber(maxChunks) || !Number.isSafeInteger(maxChunks) || maxChunks <= 0)
  ) {
    throw new EffectRpcQueryConfigError(
      'InvalidMaxChunks',
      'maxChunks must be a positive safe integer',
      { rpcTag },
    )
  }
  if (refetchMode !== 'reset' && refetchMode !== 'append' && refetchMode !== 'replace') {
    throw new EffectRpcQueryConfigError(
      'InvalidRefetchMode',
      'refetchMode must be reset, append, or replace',
      { rpcTag },
    )
  }
  return { _tag: 'Accumulated' as const, maxChunks, refetchMode }
}

export const createStreamIdentity =
  (rpcTag: string): StreamingOperation['streamedIdentity'] =>
  (options) => {
    const { maxChunks, refetchMode } = accumulatedPolicy(rpcTag, options)
    const identity: JsonValue = Object.freeze({ maxChunks: maxChunks ?? null, refetchMode })
    return [identity]
  }

/** Owns policy validation and execution for both accumulated and live queries. */
export const createStreamPreparation =
  (rpc: RpcStreamInvocation): StreamingOperation['prepareStream'] =>
  (options, operation, runPromiseExit, requestOptions) => {
    const policy: StreamQueryPolicy =
      operation === 'live' ? { _tag: 'Live' } : accumulatedPolicy(rpc.tag, options)
    delete options['refetchMode']
    delete options['maxChunks']
    // SAFETY: takeRpcOptions extracted this unchanged from the typed public options.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const rpcOptions = requestOptions as StreamingRpcOptions | undefined
    return (input) =>
      makeStreamQuery({
        policy,
        source: Stream.suspend(() => rpc.invoke(input, rpcOptions)),
        executionError: (cause) => new EffectRpcQueryError(rpc.tag, operation, cause),
        emptyError: () => new EffectRpcQueryEmptyStreamError(rpc.tag),
        runPromiseExit,
      })
  }
