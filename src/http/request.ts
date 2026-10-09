import { Predicate, Schema } from 'effect'
import { HttpApiSchema } from 'effect/http-api'
import type { HttpApiEndpoint } from 'effect/http-api'

import type { OperationInput } from '../core/operation'
import { createSchemaKeyEncoding } from '../core/schema-key'
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

export type HttpRequestDescription =
  | { readonly kind: 'Unary'; readonly input: OperationInput }
  | { readonly kind: 'Streaming'; readonly input: OperationInput }
  | { readonly kind: 'Mutation' }

const classifyEndpoint = (
  endpoint: HttpApiEndpoint.Top,
  identity: HttpApiEndpointIdentity,
):
  | { readonly kind: 'Unary' | 'Streaming'; readonly schemas: readonly Schema.Top[] }
  | { readonly kind: 'Mutation' }
  | undefined => {
  const payloads: Schema.Top[] = []
  let multipart = false
  let multipartStream = false
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
      multipart ||= expectedBuffered
      multipartStream ||= expectedStreamed
      payloads.push(schema)
    }
  }
  if (multipartStream) {
    return undefined
  }
  const successes = [...endpoint.success]
  const streams = successes.filter((schema) =>
    Predicate.hasProperty(
      HttpApiSchema.isWithHeaders(schema) ? schema.schema : schema,
      '~effect/http-api/HttpApiSchema/Stream',
    ),
  )
  if (streams.length > 0) {
    const [success] = successes
    const body = HttpApiSchema.isWithHeaders(success) ? success.schema : success
    if (
      multipart ||
      successes.length !== 1 ||
      !Predicate.hasProperty(body, '_tag') ||
      body._tag !== 'StreamSse'
    ) {
      return undefined
    }
    return { kind: 'Streaming', schemas: payloads }
  }
  return multipart ? { kind: 'Mutation' } : { kind: 'Unary', schemas: payloads }
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

export const createHttpRequest = (
  endpoint: HttpApiEndpoint.Top,
  identity: HttpApiEndpointIdentity,
): HttpRequestDescription | undefined => {
  const classified = classifyEndpoint(endpoint, identity)
  if (classified === undefined || classified.kind === 'Mutation') {
    return classified
  }
  const payloads = classified.schemas
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
    return { kind: classified.kind, input: { _tag: 'Inputless' } }
  }
  const schema = Schema.Struct(fields)
  const keyEncoding = createSchemaKeyEncoding(schema)
  const invalidKey = (cause: unknown) =>
    new EffectHttpApiQueryKeyError(
      'InvalidKeyValue',
      identity,
      `The HTTP key for ${identity.groupId}/${identity.endpoint} is not JSON-safe`,
      cause,
    )
  return {
    kind: classified.kind,
    input: {
      _tag: 'Input',
      requiresEncoder: payloads.length > 1 || keyEncoding.requiresEncoder,
      pageInput: (input) => input,
      invalidKey,
      prepare: (input, encoder) => {
        let keyValue: unknown
        try {
          keyValue = encoder ? encoder(input) : keyEncoding.encode(input)
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
    },
  }
}
