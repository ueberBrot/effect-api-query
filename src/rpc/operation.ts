import { SchemaAST } from 'effect'
import type { Rpc, RpcClient, RpcGroup } from 'effect/rpc'
import { RpcSchema } from 'effect/rpc'

import type { OperationDescription, OperationInput, TreeErrors } from '../core/operation'
import { createSchemaKeyEncoding } from '../core/schema-key'
import { EffectRpcQueryConfigError, EffectRpcQueryError, EffectRpcQueryKeyError } from './errors'
import { createStreamIdentity, createStreamPreparation } from './streamed-query'

const createRpcInput = (definition: Rpc.AnyWithProps): OperationInput => {
  const { payloadSchema, _tag: rpcTag } = definition
  if (SchemaAST.isVoid(payloadSchema.ast)) {
    return { _tag: 'Inputless' }
  }
  const keyEncoding = createSchemaKeyEncoding(payloadSchema)

  return {
    _tag: 'Input',
    requiresEncoder: keyEncoding.requiresEncoder,
    pageInput: (input) => payloadSchema.make(input),
    invalidKey: (cause) =>
      new EffectRpcQueryKeyError(
        'InvalidKeyValue',
        rpcTag,
        `The key payload for RPC ${rpcTag} is not JSON-safe`,
        cause,
      ),
    prepare: (input, encoder) => {
      let normalized: unknown
      try {
        normalized = payloadSchema.make(input)
      } catch (error) {
        throw new EffectRpcQueryKeyError(
          'PayloadConstructionFailed',
          rpcTag,
          `Could not construct the payload for RPC ${rpcTag}`,
          error,
        )
      }
      let keyValue: unknown
      try {
        keyValue = encoder ? encoder(normalized) : keyEncoding.encode(normalized)
      } catch (error) {
        throw new EffectRpcQueryKeyError(
          encoder ? 'KeyEncoderFailed' : 'PayloadEncodingFailed',
          rpcTag,
          `Could not encode the key payload for RPC ${rpcTag}`,
          error,
        )
      }
      // The ready client constructs this normalized payload again during execution.
      return { input: normalized, keyValue }
    },
  }
}

const takeRpcOptions = (options: Record<string, unknown>) => {
  const { rpcOptions } = options
  delete options['rpcOptions']
  return rpcOptions
}

const describeRpc = <Rpcs extends Rpc.Any, ClientError>(
  definition: Rpc.AnyWithProps,
  client: RpcClient.RpcClient.Flat<Rpcs, ClientError>,
): OperationDescription => {
  const rpcTag = definition._tag
  const identity = {
    id: rpcTag,
    path: rpcTag.split('.'),
    input: createRpcInput(definition),
    unsupportedQueryHash: (option: 'queryKeyHashFn' | 'queryHash') =>
      new EffectRpcQueryConfigError(
        'UnsupportedQueryHash',
        `${option} must be configured through QueryClient defaults`,
        { rpcTag },
      ),
    takeOptions: takeRpcOptions,
  }
  if (!RpcSchema.isStreamSchema(definition.successSchema)) {
    // SAFETY: The ready client belongs to this group. Its tag selects this exact
    // declaration's payload and unary result; never erases only the generic call site.
    return {
      ...identity,
      kind: 'Unary',
      invoke: (input, options) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        client(rpcTag as never, input as never, options as never),
      executionError: (operation, cause) => new EffectRpcQueryError(rpcTag, operation, cause),
    }
  }
  // SAFETY: RpcSchema identified this tag's streaming success schema; the client
  // is from the same group, so this call returns that declaration's Stream.
  return {
    ...identity,
    kind: 'Streaming',
    streamedIdentity: createStreamIdentity(rpcTag),
    prepareStream: createStreamPreparation({
      tag: rpcTag,
      invoke: (input, options) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        client(rpcTag as never, input as never, options as never) as never,
    }),
  }
}

// SAFETY: A RpcGroup stores complete runtime definitions for all its members;
// AnyWithProps restores that SDK metadata surface after generic member erasure.
export const extractRpcs = <Rpcs extends Rpc.Any, ClientError>(
  group: RpcGroup.RpcGroup<Rpcs>,
  client: RpcClient.RpcClient.Flat<Rpcs, ClientError>,
): readonly OperationDescription[] =>
  Array.from(group.requests.values(), (value) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
    describeRpc(value as unknown as Rpc.AnyWithProps, client),
  )

export const rpcTreeErrors: TreeErrors = {
  invalidPrefix: (reason, cause) =>
    new EffectRpcQueryConfigError(
      'InvalidKeyPrefix',
      reason === 'Shape'
        ? 'keyPrefix must be a non-empty readonly tuple of JSON-safe values'
        : 'keyPrefix must contain only JSON-safe values',
      { cause },
    ),
  invalidPath: (rpcTag) =>
    new EffectRpcQueryConfigError(
      'InvalidRpcPath',
      `RPC tag ${rpcTag} cannot be projected into a utility path`,
      { rpcTag },
    ),
  pathCollision: (rpcTag, segments, relation) => {
    const path = segments.join('.')
    return new EffectRpcQueryConfigError(
      'RpcPathCollision',
      `RPC tag ${rpcTag} ${relation} utility path ${path}`,
      { path, rpcTag },
    )
  },
  unknownEncoder: (rpcTag) =>
    new EffectRpcQueryConfigError(
      'UnknownKeyEncoder',
      `No payload-bearing RPC exists for key encoder ${rpcTag}`,
      { rpcTag },
    ),
  missingEncoder: (rpcTag) =>
    new EffectRpcQueryConfigError(
      'MissingKeyEncoder',
      `RPC ${rpcTag} requires a safe custom key encoder`,
      { rpcTag },
    ),
}
