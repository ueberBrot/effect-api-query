import { Effect, Predicate } from 'effect'
import type { Cause } from 'effect'
import type { Sse } from 'effect/encoding'
import type { HttpClientResponse } from 'effect/http'
import type { HttpApi } from 'effect/http-api'

import type {
  MutationOperation,
  StreamingOperation,
  RuntimeKeyEncoder,
  TreeErrors,
  UnaryOperation,
} from '../core/operation'
import { EffectHttpApiQueryConfigError, EffectHttpApiQueryError } from './errors'
import type { HttpApiEndpointIdentity } from './errors'
import { createHttpRequest } from './request'
import { createHttpStreamIdentity, createHttpStreamPreparation } from './streamed-query'

type HttpOperation = (UnaryOperation | MutationOperation | StreamingOperation) & {
  readonly identity: HttpApiEndpointIdentity
}

type RuntimeHttpMethod = <Mode extends 'decoded-only' | 'decoded-and-response'>(
  request: Record<string, unknown> & { readonly responseMode: Mode },
) => Effect.Effect<
  Mode extends 'decoded-and-response'
    ? readonly [unknown, HttpClientResponse.HttpClientResponse]
    : unknown,
  unknown,
  unknown
>

export interface CompiledHttpOperations {
  readonly operations: readonly (UnaryOperation | MutationOperation | StreamingOperation)[]
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
      const request = createHttpRequest(endpoint, identity)
      if (request === undefined) {
        continue
      }
      // SAFETY: The public client is tied to this Api. HttpApiClient mirrors group
      // identifiers and topLevel placement, with the declaration's endpoint functions.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const target = // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        (group.topLevel ? client : (client as Record<string, unknown>)[group.identifier]) as Record<
          string,
          RuntimeHttpMethod
        >
      const invoke = <Mode extends 'decoded-only' | 'decoded-and-response'>(
        requestInput: unknown,
        responseMode: Mode,
        sseOptions?: Sse.DecodeOptions,
      ) => {
        const method = target[endpoint.identifier]
        if (method === undefined) {
          throw new TypeError(`Missing HTTP client endpoint ${endpoint.identifier}`)
        }
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
        return method.bind(target)({
          ...(Predicate.isObject(requestInput) ? requestInput : undefined),
          responseMode,
          ...(sseOptions === undefined ? undefined : { sseOptions }),
        })
      }
      const common = {
        identity,
        id: JSON.stringify([group.identifier, endpoint.identifier]),
        path: group.topLevel ? [endpoint.identifier] : [group.identifier, endpoint.identifier],
        unsupportedQueryHash: (option: 'queryKeyHashFn' | 'queryHash') =>
          new EffectHttpApiQueryConfigError(
            'UnsupportedQueryHash',
            `${option} must be configured through QueryClient defaults`,
            identity,
          ),
        takeOptions: () => null,
      }
      if (request.kind === 'Streaming') {
        operations.push({
          ...common,
          ...request,
          kind: 'Streaming',
          supportsLive: false,
          streamedIdentity: createHttpStreamIdentity(identity),
          prepareStream: createHttpStreamPreparation(identity, (requestInput, sseOptions) =>
            // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
            invoke(requestInput, 'decoded-only', sseOptions),
          ),
        })
      } else {
        operations.push({
          ...common,
          ...request,
          // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
          invoke: (requestInput) => invoke(requestInput, 'decoded-only'),
          ...(request.kind === 'Unary'
            ? {
                metadata: {
                  invoke: (requestInput: unknown) =>
                    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
                    Effect.map(invoke(requestInput, 'decoded-and-response'), ([data, response]) =>
                      Object.freeze({
                        data: data === undefined ? null : data,
                        status: response.status,
                        headers: Object.freeze(
                          Object.fromEntries(Object.entries(response.headers)),
                        ),
                      }),
                    ),
                  executionError: (operation: 'metadata', cause: Cause.Cause<unknown>) =>
                    new EffectHttpApiQueryError(identity, operation, cause),
                  finalizeData: (data: unknown) => {
                    if (!Predicate.isObject(data)) {
                      return data
                    }
                    const { headers } = data
                    const snapshot =
                      Predicate.isObject(headers) && !Object.isFrozen(headers)
                        ? Object.freeze({ ...headers })
                        : headers
                    return Object.isFrozen(data) && snapshot === headers
                      ? data
                      : Object.freeze({ ...data, headers: snapshot })
                  },
                },
              }
            : undefined),
          executionError: (operation, cause) =>
            new EffectHttpApiQueryError(identity, operation, cause),
        })
      }
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
        `No query-enabled HTTP endpoint exists for key encoder ${id}`,
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
      .filter((operation) => operation.kind !== 'Mutation' && operation.input._tag === 'Input')
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
