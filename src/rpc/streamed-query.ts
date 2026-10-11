import { Stream } from 'effect'

import type { StreamingOperation } from '../core/operation'
import { accumulatedPolicy, makeStreamQuery } from '../core/streamed-query'
import type { StreamQueryPolicy } from '../core/streamed-query'
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

export const createStreamPreparation =
  (rpc: RpcStreamInvocation): StreamingOperation['prepareStream'] =>
  (options, operation, runPromiseExit, requestOptions) => {
    const policy: StreamQueryPolicy =
      operation === 'live'
        ? { _tag: 'Live' }
        : accumulatedPolicy(
            options,
            (code, message) => new EffectRpcQueryConfigError(code, message, { rpcTag: rpc.tag }),
          )
    delete options['refetchMode']
    delete options['maxChunks']
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const rpcOptions = requestOptions as StreamingRpcOptions | undefined
    return {
      identity:
        policy._tag === 'Live'
          ? []
          : [
              Object.freeze({
                maxChunks: policy.maxChunks ?? null,
                refetchMode: policy.refetchMode,
              }),
            ],
      makeQuery: (input) =>
        makeStreamQuery({
          policy,
          source: Stream.suspend(() => rpc.invoke(input, rpcOptions)),
          executionError: (cause) => new EffectRpcQueryError(rpc.tag, operation, cause),
          unsupportedHash: () =>
            new EffectRpcQueryConfigError(
              'UnsupportedQueryHash',
              'Stream queries require consistent QueryClient hashing',
              { rpcTag: rpc.tag },
            ),
          emptyError: () => new EffectRpcQueryEmptyStreamError(rpc.tag),
          runPromiseExit,
        }),
    }
  }
