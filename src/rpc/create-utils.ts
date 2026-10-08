import type { Rpc, RpcClient, RpcGroup } from 'effect/rpc'

import type { RuntimeKeyEncoder } from '../core/operation'
import type { JsonValue, RunPromiseExit } from '../core/types'
import { createUtilityTree } from '../core/utility-tree'
import { extractRpcs, rpcTreeErrors } from './operation'
import type { CreateRpcQueryUtilsOptions, RpcQueryUtils } from './types'

/**
 * Derives an eager, frozen TanStack Query utility tree from an Effect RPC group.
 *
 * Dotted RPC tags become nested properties with unary or streaming utility leaves.
 * The caller retains ownership of the ready client's Scope and lifecycle.
 *
 * @throws {@link EffectRpcQueryConfigError} if the prefix, paths, or encoders are invalid.
 */
export const createRpcQueryUtils = <
  const Group extends RpcGroup.Any,
  const Prefix extends readonly [JsonValue, ...JsonValue[]],
  ClientError = never,
>(
  group: Group,
  options: CreateRpcQueryUtilsOptions<Group, Prefix, ClientError>,
): RpcQueryUtils<Group, Prefix, ClientError> => {
  const runtimeGroup = group as unknown as RpcGroup.RpcGroup<Rpc.Any>
  const client = options.client as RpcClient.RpcClient.Flat<Rpc.Any, ClientError>
  const rpcs = extractRpcs(runtimeGroup, client)
  return createUtilityTree(rpcs, {
    keyPrefix: options.keyPrefix,
    keyNamespace: ['rpc'],
    keyEncoders: new Map(Object.entries(options.keyEncoders ?? {})) as Map<
      string,
      RuntimeKeyEncoder
    >,
    runPromiseExit: options.runPromiseExit as RunPromiseExit<unknown> | undefined,
    errors: rpcTreeErrors,
  }) as RpcQueryUtils<Group, Prefix, ClientError>
}
