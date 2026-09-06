import type { Effect } from 'effect'
import type { HttpApi } from 'effect/unstable/httpapi'

import type { TreeErrors, UnaryOperation } from '../core/operation'
import { EffectHttpApiQueryConfigError, EffectHttpApiQueryError } from './errors'
import type { HttpApiEndpointIdentity } from './errors'
import { createHttpRequestInput } from './request'

export interface HttpOperation extends UnaryOperation {
  readonly identity: HttpApiEndpointIdentity
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
      const input = createHttpRequestInput(endpoint, identity)
      if (input === undefined) continue
      const target = (
        group.topLevel ? client : (client as Record<string, unknown>)[group.identifier]
      ) as Record<string, (request: unknown) => Effect.Effect<unknown, unknown, unknown>>
      operations.push({
        identity,
        id: JSON.stringify([group.identifier, endpoint.identifier]),
        path: group.topLevel ? [endpoint.identifier] : [group.identifier, endpoint.identifier],
        kind: 'Unary',
        input,
        pageInput: (input) => input,
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
