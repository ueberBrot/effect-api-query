import { Predicate } from 'effect'
import type { Effect } from 'effect'
import type { HttpApi } from 'effect/http-api'

import type { RuntimeKeyEncoder, TreeErrors, UnaryOperation } from '../core/operation'
import { EffectHttpApiQueryConfigError, EffectHttpApiQueryError } from './errors'
import type { HttpApiEndpointIdentity } from './errors'
import { createHttpRequestInput } from './request'

interface HttpOperation extends UnaryOperation {
  readonly identity: HttpApiEndpointIdentity
}

export interface CompiledHttpOperations {
  readonly operations: readonly UnaryOperation[]
  readonly errors: TreeErrors
  readonly keyEncoders: ReadonlyMap<string, RuntimeKeyEncoder>
}

const extractHttpEndpoints = (api: HttpApi.Top, client: unknown): readonly HttpOperation[] => {
  const operations: HttpOperation[] = []
  for (const group of Object.values(api.groups)) {
    for (const endpoint of Object.values(group.endpoints)) {
      const identity = {
        apiId: api.identifier,
        groupId: group.identifier,
        endpoint: endpoint.identifier,
        method: endpoint.method,
      }
      const input = createHttpRequestInput(endpoint, identity)
      if (input === undefined) {
        continue
      }
      // SAFETY: The public client is tied to this Api. HttpApiClient mirrors group
      // identifiers and topLevel placement, with the declaration's endpoint functions.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const target = // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        (group.topLevel ? client : (client as Record<string, unknown>)[group.identifier]) as Record<
          string,
          (request: unknown) => Effect.Effect<unknown, unknown, unknown>
        >
      operations.push({
        identity,
        id: JSON.stringify([group.identifier, endpoint.identifier]),
        path: group.topLevel ? [endpoint.identifier] : [group.identifier, endpoint.identifier],
        kind: 'Unary',
        input,
        takeOptions: () => {
          // HTTP has no adapter-owned options.
        },
        invoke: (requestInput) => {
          const invoke = target[endpoint.identifier]
          if (invoke === undefined) {
            throw new TypeError(`Missing HTTP client endpoint ${endpoint.identifier}`)
          }
          // The ready client preserves caller errors and service requirements.
          // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
          return invoke.call(target, {
            ...(Predicate.isObject(requestInput) ? requestInput : undefined),
            responseMode: 'decoded-only',
          })
        },
        executionError: (operation, cause) =>
          new EffectHttpApiQueryError(identity, operation, cause),
      })
    }
  }
  return operations
}

const httpTreeErrors = (api: HttpApi.Top, operations: readonly HttpOperation[]): TreeErrors => {
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

/** Binds declaration identities, endpoint projection, and encoder configuration together. */
export const compileHttpOperations = (
  api: HttpApi.Top,
  client: unknown,
  suppliedEncoders: unknown,
): CompiledHttpOperations => {
  const operations = extractHttpEndpoints(api, client)
  const errors = httpTreeErrors(api, operations)
  const encoderGroups = new Set(
    operations
      .filter((operation) => operation.input._tag === 'Input')
      .map((operation) => operation.identity.groupId),
  )
  const keyEncoders = new Map<string, RuntimeKeyEncoder>()
  for (const [groupId, endpoints] of Object.entries(
    Predicate.isObject(suppliedEncoders) ? suppliedEncoders : {},
  )) {
    if (!encoderGroups.has(groupId)) {
      throw errors.unknownEncoder(JSON.stringify([groupId]))
    }
    if (!Predicate.isObject(endpoints)) {
      throw new TypeError('HTTP key encoders must be grouped by endpoint')
    }
    for (const [endpoint, encoder] of Object.entries(endpoints)) {
      // SAFETY: Public keyEncoders pairs each endpoint with a payload encoder;
      // the runtime tree validates required callability and canonicalizes its result.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      keyEncoders.set(JSON.stringify([groupId, endpoint]), encoder as RuntimeKeyEncoder)
    }
  }
  return { operations, errors, keyEncoders }
}
