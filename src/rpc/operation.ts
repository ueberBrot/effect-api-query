import { Schema, SchemaAST } from 'effect'
import type { Effect } from 'effect'
import { Rpc, RpcClient, RpcGroup, RpcSchema } from 'effect/unstable/rpc'

import type { OperationDescription, RuntimeKeyEncoder, TreeErrors } from '../core/operation'
import { containsUnsafeKeyEncoding } from '../core/schema-key'
import { EffectRpcQueryConfigError, EffectRpcQueryError, EffectRpcQueryKeyError } from './errors'
import { makeStreamQuery } from './streamed-query'
import type { StreamRefetchMode, StreamingRpcOptions } from './types'

type AdaptedKeyPayload =
  | {
      readonly _tag: 'Payloadless'
    }
  | {
      readonly _tag: 'DefaultEncoding'
      /** Schema-encodes a normalized payload for semantic cache identity. */
      readonly encode: (payload: unknown) => unknown
      /** Applies constructor defaults and validation synchronously. */
      readonly make: (input: unknown) => unknown
    }
  | {
      readonly _tag: 'CustomEncodingRequired'
      /** Applies constructor defaults and validation synchronously. */
      readonly make: (input: unknown) => unknown
    }

const adaptKeyPayload = (payloadSchema: Rpc.AnyWithProps['payloadSchema']): AdaptedKeyPayload => {
  if (SchemaAST.isVoid(payloadSchema.ast)) {
    return { _tag: 'Payloadless' }
  }

  const make = (input: unknown) => payloadSchema.make(input)
  if (containsUnsafeKeyEncoding(payloadSchema.ast)) {
    return { _tag: 'CustomEncodingRequired', make }
  }

  return {
    _tag: 'DefaultEncoding',
    encode: (payload) =>
      Schema.encodeUnknownSync(
        payloadSchema as unknown as Schema.ConstraintEncoder<unknown, never>,
      )(payload),
    make,
  }
}

export const extractRpcs = <Rpcs extends Rpc.Any, ClientError>(
  group: RpcGroup.RpcGroup<Rpcs>,
  client: RpcClient.RpcClient.Flat<Rpcs, ClientError>,
): ReadonlyArray<OperationDescription> =>
  Array.from(group.requests.values(), (value) =>
    describeRpc(value as unknown as Rpc.AnyWithProps, client),
  )

const preparePayload = (
  rpcTag: string,
  keyPayload: Exclude<AdaptedKeyPayload, { readonly _tag: 'Payloadless' }>,
  input: unknown,
  keyEncoder: RuntimeKeyEncoder | undefined,
) => {
  let normalized: unknown
  try {
    normalized = keyPayload.make(input)
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
    keyValue = keyEncoder
      ? keyEncoder(normalized)
      : keyPayload._tag === 'DefaultEncoding'
        ? keyPayload.encode(normalized)
        : undefined
  } catch (cause) {
    throw new EffectRpcQueryKeyError(
      keyEncoder ? 'KeyEncoderFailed' : 'PayloadEncodingFailed',
      rpcTag,
      `Could not encode the key payload for RPC ${rpcTag}`,
      cause,
    )
  }
  // The ready client constructs this normalized payload again during execution.
  return { input: normalized, keyValue }
}

const takeRpcOptions = (options: Record<string, unknown>) => {
  const rpcOptions = options['rpcOptions']
  delete options['rpcOptions']
  return rpcOptions
}

const describeRpc = <Rpcs extends Rpc.Any, ClientError>(
  definition: Rpc.AnyWithProps,
  client: RpcClient.RpcClient.Flat<Rpcs, ClientError>,
): OperationDescription => {
  const keyPayload = adaptKeyPayload(definition.payloadSchema)
  const rpcTag = definition._tag
  const identity = {
    id: rpcTag,
    path: rpcTag.split('.'),
    input:
      keyPayload._tag === 'Payloadless'
        ? { _tag: 'Inputless' as const }
        : {
            _tag: 'Input' as const,
            requiresEncoder: keyPayload._tag === 'CustomEncodingRequired',
            prepare: (input: unknown, encoder: RuntimeKeyEncoder | undefined) =>
              preparePayload(rpcTag, keyPayload, input, encoder),
            invalidKey: (cause: unknown) =>
              new EffectRpcQueryKeyError(
                'InvalidKeyValue',
                rpcTag,
                `The key payload for RPC ${rpcTag} is not JSON-safe`,
                cause,
              ),
          },
    takeOptions: takeRpcOptions,
  }
  if (!RpcSchema.isStreamSchema(definition.successSchema)) {
    return {
      ...identity,
      kind: 'Unary',
      pageInput: keyPayload._tag === 'Payloadless' ? () => undefined : keyPayload.make,
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
    prepareStream: (options, operation, runPromiseExit, requestOptions) => {
      const refetchMode = options['refetchMode'] as StreamRefetchMode | undefined
      delete options['refetchMode']
      const maxChunks = options['maxChunks'] as number | undefined
      delete options['maxChunks']
      if (maxChunks !== undefined && (!Number.isSafeInteger(maxChunks) || maxChunks <= 0)) {
        throw new EffectRpcQueryConfigError(
          'InvalidMaxChunks',
          'maxChunks must be a positive safe integer',
          { rpcTag: rpcTag },
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
          rpc: {
            tag: rpcTag,
            invoke: (input, options) =>
              client(rpcTag as never, input as never, options as never) as never,
          },
          runPromiseExit,
        })
    },
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
