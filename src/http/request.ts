import { Predicate, Schema } from 'effect'
import { HttpApiSchema } from 'effect/http-api'
import type { HttpApiEndpoint } from 'effect/http-api'

import type { OperationInput } from '../core/operation'
import { containsUnsafeKeyEncoding } from '../core/schema-key'
import { EffectHttpApiQueryConfigError, EffectHttpApiQueryKeyError } from './errors'
import type { HttpApiEndpointIdentity } from './errors'

// Codec conversion can wrap a branded schema; the brand remains on its inner schema.
const multipartBrands = (schema: Schema.Top): ReadonlySet<string> => {
  const brands = new Set<string>()
  const visited = new WeakSet()
  let current: unknown = schema
  while (Schema.isSchema(current) && !visited.has(current)) {
    visited.add(current)
    if (
      Predicate.hasProperty(current, 'identifier') &&
      (current.identifier === HttpApiSchema.MultipartTypeId ||
        current.identifier === HttpApiSchema.MultipartStreamTypeId)
    ) {
      brands.add(current.identifier)
    }
    current = Predicate.hasProperty(current, 'schema') ? current.schema : undefined
  }
  return brands
}

const bufferedPayloads = (
  endpoint: HttpApiEndpoint.Top,
  identity: HttpApiEndpointIdentity,
): readonly Schema.Top[] | undefined => {
  const payloads: Schema.Top[] = []
  let multipart = false
  for (const { encoding, schemas } of endpoint.payload.values()) {
    for (const schema of schemas) {
      const brands = multipartBrands(schema)
      const buffered = brands.has(HttpApiSchema.MultipartTypeId)
      const streamed = brands.has(HttpApiSchema.MultipartStreamTypeId)
      const expectedBuffered = encoding._tag === 'Multipart' && encoding.mode === 'buffered'
      const expectedStreamed = encoding._tag === 'Multipart' && encoding.mode === 'stream'
      const metadataAgrees = buffered === expectedBuffered && streamed === expectedStreamed
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
    [...endpoint.success].some((schema) =>
      Predicate.hasProperty(
        HttpApiSchema.isWithHeaders(schema) ? schema.schema : schema,
        '~effect/http-api/HttpApiSchema/Stream',
      ),
    )
  ) {
    return undefined
  }
  return payloads
}

// HTTP omits undefined object members; arrays still undergo strict JSON validation.
const omitUndefined = (value: unknown, seen = new WeakSet()): unknown => {
  if (!Predicate.isObjectOrArray(value)) {
    return value
  }
  if (seen.has(value)) {
    throw new TypeError('Key values must not contain cycles')
  }
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
  const request = omitUndefined(value)
  if (!Predicate.isObject(request)) {
    throw new TypeError('Encoded HTTP requests must be objects')
  }
  if (Predicate.isObject(request['headers'])) {
    // SAFETY: Object.create(null) allocates an empty dictionary without a prototype.
    // oxlint-disable-next-line typescript/no-unsafe-assignment
    const headers: Record<string, unknown> = Object.create(null)
    for (const [name, headerValue] of Object.entries(request['headers'])) {
      const lower = name.toLowerCase()
      if (
        Object.hasOwn(headers, lower) &&
        JSON.stringify(headers[lower]) !== JSON.stringify(headerValue)
      ) {
        throw new TypeError('Encoded header names must not have conflicting values')
      }
      headers[lower] = headerValue
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
  if (payloads === undefined) {
    return undefined
  }
  const fields: Record<string, Schema.Top> = {}
  if (endpoint.params !== undefined) {
    fields['params'] = endpoint.params
  }
  if (endpoint.query !== undefined) {
    fields['query'] = endpoint.query
  }
  if (endpoint.headers !== undefined) {
    fields['headers'] = endpoint.headers
  }
  if (payloads.length > 0) {
    fields['payload'] = Schema.Union(payloads)
  }
  if (Object.keys(fields).length === 0) {
    return { _tag: 'Inputless' }
  }
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
    pageInput: (input) => input,
    invalidKey,
    prepare: (input, encoder) => {
      let keyValue: unknown
      try {
        if (encoder) {
          keyValue = encoder(input)
        } else {
          // SAFETY: Middleware requiring encoding services needs a custom encoder;
          // the remaining generated request schema can encode synchronously.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
          const encodingSchema = schema as unknown as Schema.ConstraintEncoder<unknown>
          const encode = Schema.encodeUnknownSync(encodingSchema)
          keyValue = encode(input)
        }
      } catch (error) {
        throw new EffectHttpApiQueryKeyError(
          encoder ? 'KeyEncoderFailed' : 'RequestEncodingFailed',
          identity,
          `Could not encode the HTTP key for ${identity.groupId}/${identity.endpoint}`,
          error,
        )
      }
      try {
        return { input, keyValue: encoder ? keyValue : normalizeRequestKey(keyValue) }
      } catch (error) {
        throw invalidKey(error)
      }
    },
  }
}
