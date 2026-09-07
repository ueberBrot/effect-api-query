import { Schema, SchemaAST } from 'effect'
import type { Effect } from 'effect'
import { Rpc, RpcClient, RpcGroup, RpcSchema } from 'effect/unstable/rpc'

import type { OperationDescription, OperationInput, TreeErrors } from '../core/operation'
import { containsUnsafeKeyEncoding } from '../core/schema-key'
import { EffectRpcQueryConfigError, EffectRpcQueryError, EffectRpcQueryKeyError } from './errors'
import { createStreamPreparation } from './streamed-query'

const createRpcInput = (definition: Rpc.AnyWithProps): OperationInput => {
  const { payloadSchema, _tag: rpcTag } = definition
  if (SchemaAST.isVoid(payloadSchema.ast)) return { _tag: 'Inputless' }

  return {
    _tag: 'Input',
    requiresEncoder: containsUnsafeKeyEncoding(payloadSchema.ast),
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
      } catch (cause) {
        throw new EffectRpcQueryKeyError(
          'PayloadConstructionFailed',
          rpcTag,
          `Could not construct the payload for RPC ${rpcTag}`,
          cause,
        )
      }
      let keyValue: unknown
      try {
        keyValue = encoder
          ? encoder(normalized)
          : Schema.encodeUnknownSync(
              payloadSchema as unknown as Schema.ConstraintEncoder<unknown, never>,
            )(normalized)
      } catch (cause) {
        throw new EffectRpcQueryKeyError(
          encoder ? 'KeyEncoderFailed' : 'PayloadEncodingFailed',
          rpcTag,
          `Could not encode the key payload for RPC ${rpcTag}`,
          cause,
        )
      }
      // The ready client constructs this normalized payload again during execution.
      return { input: normalized, keyValue }
    },
  }
}

export const extractRpcs = <Rpcs extends Rpc.Any, ClientError>(
  group: RpcGroup.RpcGroup<Rpcs>,
  client: RpcClient.RpcClient.Flat<Rpcs, ClientError>,
): ReadonlyArray<OperationDescription> =>
  Array.from(group.requests.values(), (value) =>
    describeRpc(value as unknown as Rpc.AnyWithProps, client),
  )

const takeRpcOptions = (options: Record<string, unknown>) => {
  const rpcOptions = options['rpcOptions']
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
    takeOptions: takeRpcOptions,
  }
  if (!RpcSchema.isStreamSchema(definition.successSchema)) {
    return {
      ...identity,
      kind: 'Unary',
      invoke: (input, options) =>
        client(rpcTag as never, input as never, options as never) as Effect.Effect<
          unknown,
          unknown,
          unknown
        >,
      executionError: (operation, cause) => new EffectRpcQueryError(rpcTag, operation, cause),
    }
  }
  return {
    ...identity,
    kind: 'Streaming',
    prepareStream: createStreamPreparation({
      tag: rpcTag,
      invoke: (input, options) =>
        client(rpcTag as never, input as never, options as never) as never,
    }),
  }
}

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
