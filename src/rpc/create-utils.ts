import type { Rpc, RpcClient, RpcGroup } from 'effect/rpc'

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
  // SAFETY: Group is a RpcGroup.Any; this erases its member union only for runtime
  // enumeration. The returned tree retains that union in the public generic type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  const runtimeGroup = group as unknown as RpcGroup.RpcGroup<Rpc.Any>
  // SAFETY: options.client is tied to this same Group by CreateRpcQueryUtilsOptions.
  const client = options.client as RpcClient.RpcClient.Flat<Rpc.Any, ClientError>
  const rpcs = extractRpcs(runtimeGroup, client)
  // SAFETY: Public options require a runner for any remaining client services.
  // The runtime tree preserves this runner unchanged while erasing its Context type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const runPromiseExit = options.runPromiseExit as RunPromiseExit<unknown> | undefined
  const tree = createUtilityTree(rpcs, {
    keyPrefix: options.keyPrefix,
    keyNamespace: ['rpc'],
    keyEncoders: new Map(Object.entries(options.keyEncoders ?? {})),
    runPromiseExit,
    errors: rpcTreeErrors,
  })
  // SAFETY: extractRpcs projects every Group member, preserving each tag/payload.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return tree as RpcQueryUtils<Group, Prefix, ClientError>
}
