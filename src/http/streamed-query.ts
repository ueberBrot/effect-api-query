import { Effect, Predicate, Stream } from 'effect'
import type { Sse } from 'effect/encoding'
import { HttpApiSchema } from 'effect/http-api'

import type { StreamingOperation } from '../core/operation'
import { makeStreamQuery } from '../core/streamed-query'
import type { StreamQueryPolicy } from '../core/streamed-query'
import type { JsonValue } from '../core/types'
import { EffectHttpApiQueryConfigError, EffectHttpApiQueryError } from './errors'
import type { HttpApiEndpointIdentity } from './errors'

const decoderOptions = (
  identity: HttpApiEndpointIdentity,
  options: Record<string, unknown>,
): Sse.DecodeOptions & { readonly maxEventSize: number } => {
  const { sseOptions } = options
  const maxEventSize = Predicate.isObject(sseOptions) ? sseOptions['maxEventSize'] : undefined
  const limit = maxEventSize === undefined ? 10 * 1024 * 1024 : maxEventSize
  if (!Predicate.isNumber(limit) || !Number.isSafeInteger(limit) || limit <= 0) {
    throw new EffectHttpApiQueryConfigError(
      'InvalidMaxEventSize',
      'sseOptions.maxEventSize must be a positive safe integer',
      identity,
    )
  }
  return Object.freeze({ maxEventSize: limit })
}

const accumulatedPolicy = (
  identity: HttpApiEndpointIdentity,
  options: Record<string, unknown>,
): Extract<StreamQueryPolicy, { readonly _tag: 'Accumulated' }> => {
  const { maxChunks, refetchMode = 'reset' } = options
  if (
    maxChunks !== undefined &&
    (!Predicate.isNumber(maxChunks) || !Number.isSafeInteger(maxChunks) || maxChunks <= 0)
  ) {
    throw new EffectHttpApiQueryConfigError(
      'InvalidMaxChunks',
      'maxChunks must be a positive safe integer',
      identity,
    )
  }
  if (refetchMode !== 'reset' && refetchMode !== 'append' && refetchMode !== 'replace') {
    throw new EffectHttpApiQueryConfigError(
      'InvalidRefetchMode',
      'refetchMode must be reset, append, or replace',
      identity,
    )
  }
  return { _tag: 'Accumulated', maxChunks, refetchMode }
}

export const createHttpStreamIdentity =
  (identity: HttpApiEndpointIdentity): StreamingOperation['streamedIdentity'] =>
  (options) => {
    const { maxChunks, refetchMode } = accumulatedPolicy(identity, options)
    const { maxEventSize } = decoderOptions(identity, options)
    const policy: JsonValue = Object.freeze({
      maxChunks: maxChunks ?? null,
      refetchMode,
      maxEventSize,
    })
    return [policy]
  }

export const createHttpStreamPreparation =
  (
    identity: HttpApiEndpointIdentity,
    invoke: (
      input: unknown,
      sseOptions: Sse.DecodeOptions,
    ) => Effect.Effect<unknown, unknown, unknown>,
  ): StreamingOperation['prepareStream'] =>
  (options, _operation, runPromiseExit) => {
    const policy = accumulatedPolicy(identity, options)
    const sseOptions = decoderOptions(identity, options)
    delete options['refetchMode']
    delete options['maxChunks']
    delete options['sseOptions']
    return (input) =>
      makeStreamQuery({
        policy,
        source: Stream.unwrap(
          // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
          Effect.suspend(() => invoke(input, sseOptions)).pipe(
            Effect.map((response) => {
              if (
                Predicate.hasProperty(response, 'body') &&
                Predicate.hasProperty(response, 'headers') &&
                Stream.isStream(response.body)
              ) {
                return response.body.pipe(
                  Stream.map((body) =>
                    HttpApiSchema.withHeaders({ body, headers: response.headers }),
                  ),
                )
              }
              if (!Stream.isStream(response)) {
                throw new TypeError('HTTP SSE clients must return a Stream')
              }
              return response
            }),
          ),
        ),
        executionError: (cause) => new EffectHttpApiQueryError(identity, 'streamed', cause),
        runPromiseExit,
      })
  }
