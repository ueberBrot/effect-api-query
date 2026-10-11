import { Effect, Predicate, Stream } from 'effect'
import type { Sse } from 'effect/encoding'
import { HttpApiSchema } from 'effect/http-api'

import type { StreamingOperation } from '../core/operation'
import { accumulatedPolicy, makeStreamQuery } from '../core/streamed-query'
import type { StreamQueryPolicy } from '../core/streamed-query'
import {
  EffectHttpApiQueryConfigError,
  EffectHttpApiQueryEmptyStreamError,
  EffectHttpApiQueryError,
} from './errors'
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

export const createHttpStreamPreparation =
  (
    identity: HttpApiEndpointIdentity,
    invoke: (
      input: unknown,
      sseOptions: Sse.DecodeOptions,
    ) => Effect.Effect<unknown, unknown, unknown>,
  ): StreamingOperation['prepareStream'] =>
  (options, operation, runPromiseExit) => {
    const policy: StreamQueryPolicy =
      operation === 'live'
        ? { _tag: 'Live' }
        : accumulatedPolicy(
            options,
            (code, message) => new EffectHttpApiQueryConfigError(code, message, identity),
          )
    const sseOptions = decoderOptions(identity, options)
    delete options['refetchMode']
    delete options['maxChunks']
    delete options['sseOptions']
    return {
      identity: [
        Object.freeze({
          ...(policy._tag === 'Live'
            ? undefined
            : {
                maxChunks: policy.maxChunks ?? null,
                refetchMode: policy.refetchMode,
              }),
          maxEventSize: sseOptions.maxEventSize,
        }),
      ],
      makeQuery: (input) =>
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
          executionError: (cause) => new EffectHttpApiQueryError(identity, operation, cause),
          emptyError: () => new EffectHttpApiQueryEmptyStreamError(identity),
          runPromiseExit,
        }),
    }
  }
