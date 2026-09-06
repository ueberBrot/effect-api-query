import { Predicate, Schema } from 'effect'
import { HttpApiSchema } from 'effect/unstable/httpapi'
import type { HttpApiEndpoint } from 'effect/unstable/httpapi'

import type { OperationInput } from '../core/operation'
import { containsUnsafeKeyEncoding } from '../core/schema-key'
import { EffectHttpApiQueryConfigError, EffectHttpApiQueryKeyError } from './errors'
import type { HttpApiEndpointIdentity } from './errors'

const bufferedPayloads = (
  endpoint: HttpApiEndpoint.Top,
  identity: HttpApiEndpointIdentity,
): readonly Schema.Top[] | undefined => {
  const payloads: Schema.Top[] = []
  let multipart = false
  for (const { encoding, schemas } of endpoint.payload.values()) {
    for (const schema of schemas) {
      const brands = (schema.ast.annotations?.['brands'] as readonly string[] | undefined) ?? []
      const buffered = brands.includes(HttpApiSchema.MultipartTypeId)
      const streamed = brands.includes(HttpApiSchema.MultipartStreamTypeId)
      const metadataAgrees =
        encoding._tag === 'Multipart'
          ? encoding.mode === 'buffered'
            ? buffered && !streamed
            : streamed && !buffered
          : !buffered && !streamed
      if (!metadataAgrees) {
        throw new EffectHttpApiQueryConfigError(
          'UnsupportedEndpointMetadata',
          `HTTP endpoint ${identity.groupId}/${identity.endpoint} has contradictory multipart metadata`,
          identity,
        )
      }
      multipart ||= encoding._tag === 'Multipart'
      payloads.push(schema)
    }
  }
  if (
    multipart ||
    Array.from(endpoint.success).some((schema) =>
      Predicate.hasProperty(
        HttpApiSchema.isWithHeaders(schema) ? schema.schema : schema,
        '~effect/httpapi/HttpApiSchema/Stream',
      ),
    )
  )
    return undefined
  return payloads
}

// HTTP omits undefined object members; arrays still undergo strict JSON validation.
const omitUndefined = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (!Predicate.isObjectOrArray(value)) return value
  if (seen.has(value)) throw new TypeError('Key values must not contain cycles')
  seen.add(value)
  let result: unknown = value
  if (Array.isArray(value)) {
    result = value.map((item) => omitUndefined(item, seen))
  } else if (
    Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null
  ) {
    result = Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([name, item]) => [name, omitUndefined(item, seen)]),
    )
  }
  seen.delete(value)
  return result
}

const normalizeRequestKey = (value: unknown): unknown => {
  const request = omitUndefined(value) as Record<string, unknown>
  if (Predicate.isObject(request['headers'])) {
    const headers: Record<string, unknown> = Object.create(null)
    for (const [name, value] of Object.entries(request['headers'])) {
      const lower = name.toLowerCase()
      if (
        Object.hasOwn(headers, lower) &&
        JSON.stringify(headers[lower]) !== JSON.stringify(value)
      ) {
        throw new TypeError('Encoded header names must not have conflicting values')
      }
      headers[lower] = value
    }
    request['headers'] = headers
  }
  return request
}

/** Returns a complete input description, or omits an endpoint requiring streaming or multipart. */
export const createHttpRequestInput = (
  endpoint: HttpApiEndpoint.Top,
  identity: HttpApiEndpointIdentity,
): OperationInput | undefined => {
  const payloads = bufferedPayloads(endpoint, identity)
  if (payloads === undefined) return undefined
  const fields: Record<string, Schema.Top> = {}
  if (endpoint.params !== undefined) fields['params'] = endpoint.params
  if (endpoint.query !== undefined) fields['query'] = endpoint.query
  if (endpoint.headers !== undefined) fields['headers'] = endpoint.headers
  if (payloads.length > 0) fields['payload'] = Schema.Union(payloads)
  if (Object.keys(fields).length === 0) return { _tag: 'Inputless' }
  const schema = Schema.Struct(fields)
  const invalidKey = (cause: unknown) =>
    new EffectHttpApiQueryKeyError(
      'InvalidKeyValue',
      identity,
      `The HTTP key for ${identity.groupId}/${identity.endpoint} is not JSON-safe`,
      cause,
    )
  return {
    _tag: 'Input',
    requiresEncoder: payloads.length > 1 || containsUnsafeKeyEncoding(schema.ast),
    invalidKey,
    prepare: (input, encoder) => {
      let keyValue: unknown
      try {
        keyValue = encoder
          ? encoder(input)
          : Schema.encodeUnknownSync(schema as unknown as Schema.ConstraintEncoder<unknown, never>)(
              input,
            )
      } catch (cause) {
        throw new EffectHttpApiQueryKeyError(
          encoder ? 'KeyEncoderFailed' : 'RequestEncodingFailed',
          identity,
          `Could not encode the HTTP key for ${identity.groupId}/${identity.endpoint}`,
          cause,
        )
      }
      try {
        return { input, keyValue: encoder ? keyValue : normalizeRequestKey(keyValue) }
      } catch (cause) {
        throw invalidKey(cause)
      }
    },
  }
}
