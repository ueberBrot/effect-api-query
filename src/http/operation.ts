import { Predicate, Schema } from 'effect'
import type { Effect } from 'effect'
import { HttpApiSchema } from 'effect/unstable/httpapi'
import type { HttpApi, HttpApiEndpoint } from 'effect/unstable/httpapi'

import type { RuntimeKeyEncoder, TreeErrors, UnaryOperation } from '../core/operation'
import { containsUnsafeKeyEncoding } from '../core/schema-key'
import {
  EffectHttpApiQueryConfigError,
  EffectHttpApiQueryError,
  EffectHttpApiQueryKeyError,
} from './errors'
import type { HttpApiEndpointIdentity } from './errors'

export interface HttpOperation extends UnaryOperation {
  readonly identity: HttpApiEndpointIdentity
}

const isSupported = (endpoint: HttpApiEndpoint.Top, identity: HttpApiEndpointIdentity): boolean => {
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
    }
  }
  return (
    !multipart &&
    !Array.from(endpoint.success).some((schema) =>
      Predicate.hasProperty(
        HttpApiSchema.isWithHeaders(schema) ? schema.schema : schema,
        '~effect/httpapi/HttpApiSchema/Stream',
      ),
    )
  )
}

const requestSchema = (endpoint: HttpApiEndpoint.Top): Schema.Top | undefined => {
  const fields: Record<string, Schema.Top> = {}
  if (endpoint.params !== undefined) fields['params'] = endpoint.params
  if (endpoint.query !== undefined) fields['query'] = endpoint.query
  if (endpoint.headers !== undefined) fields['headers'] = endpoint.headers
  const payloads = Array.from(endpoint.payload.values()).flatMap(({ schemas }) => schemas)
  if (payloads.length > 0) fields['payload'] = Schema.Union(payloads)
  return Object.keys(fields).length === 0 ? undefined : Schema.Struct(fields)
}

const prepareRequest = (
  identity: HttpApiEndpointIdentity,
  schema: Schema.Top,
  input: unknown,
  encoder: RuntimeKeyEncoder | undefined,
) => {
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
    throw new EffectHttpApiQueryKeyError(
      'InvalidKeyValue',
      identity,
      `The HTTP key for ${identity.groupId}/${identity.endpoint} is not JSON-safe`,
      cause,
    )
  }
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

export const extractHttpEndpoints = (
  api: HttpApi.Top,
  client: unknown,
): readonly HttpOperation[] => {
  const operations: HttpOperation[] = []
  for (const group of Object.values(api.groups)) {
    for (const endpoint of Object.values(group.endpoints)) {
      const identity = {
        apiId: api.identifier,
        groupId: group.identifier,
        endpoint: endpoint.identifier,
        method: endpoint.method,
      }
      if (!isSupported(endpoint, identity)) continue
      const schema = requestSchema(endpoint)
      const target = (
        group.topLevel ? client : (client as Record<string, unknown>)[group.identifier]
      ) as Record<string, (request: unknown) => Effect.Effect<unknown, unknown, unknown>>
      operations.push({
        identity,
        id: JSON.stringify([group.identifier, endpoint.identifier]),
        path: group.topLevel ? [endpoint.identifier] : [group.identifier, endpoint.identifier],
        kind: 'Unary',
        input:
          schema === undefined
            ? { _tag: 'Inputless' }
            : {
                _tag: 'Input',
                requiresEncoder:
                  Array.from(endpoint.payload.values()).reduce(
                    (count, entry) => count + entry.schemas.length,
                    0,
                  ) > 1 || containsUnsafeKeyEncoding(schema.ast),
                prepare: (input, encoder) => prepareRequest(identity, schema, input, encoder),
                invalidKey: (cause) =>
                  new EffectHttpApiQueryKeyError(
                    'InvalidKeyValue',
                    identity,
                    `The HTTP key for ${group.identifier}/${endpoint.identifier} is not JSON-safe`,
                    cause,
                  ),
              },
        takeOptions: () => undefined,
        invoke: (input) =>
          target[endpoint.identifier]!({
            ...(input as object | undefined),
            responseMode: 'decoded-only',
          }),
        executionError: (operation, cause) =>
          new EffectHttpApiQueryError(identity, operation, cause),
      })
    }
  }
  return operations
}

export const httpTreeErrors = (
  api: HttpApi.Top,
  operations: readonly HttpOperation[],
): TreeErrors => {
  const identities = new Map(operations.map((operation) => [operation.id, operation.identity]))
  const identity = (id: string) => identities.get(id) ?? { apiId: api.identifier }
  return {
    invalidPrefix: (reason, cause) =>
      new EffectHttpApiQueryConfigError(
        'InvalidKeyPrefix',
        reason === 'Shape'
          ? 'keyPrefix must be a non-empty readonly tuple of JSON-safe values'
          : 'keyPrefix must contain only JSON-safe values',
        { apiId: api.identifier, cause },
      ),
    invalidPath: (id) =>
      new EffectHttpApiQueryConfigError(
        'InvalidEndpointPath',
        `HTTP endpoint ${id} cannot be projected into a utility path`,
        identity(id),
      ),
    pathCollision: (id, path, relation) =>
      new EffectHttpApiQueryConfigError(
        'EndpointPathCollision',
        `HTTP endpoint ${id} ${relation} utility path ${JSON.stringify(path)}`,
        { ...identity(id), path },
      ),
    unknownEncoder: (id) =>
      new EffectHttpApiQueryConfigError(
        'UnknownKeyEncoder',
        `No request-bearing HTTP endpoint exists for key encoder ${id}`,
        identity(id),
      ),
    missingEncoder: (id) =>
      new EffectHttpApiQueryConfigError(
        'MissingKeyEncoder',
        `HTTP endpoint ${id} requires a safe custom key encoder`,
        identity(id),
      ),
  }
}
