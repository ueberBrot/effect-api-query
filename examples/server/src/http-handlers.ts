import {
  exampleHttpApi,
  ExampleAuthorizationError,
  ExampleHttpAuthorization,
} from '@effect-api-query/contracts'
import { Effect, Layer } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { ExampleDomain } from './domain.ts'

const users = HttpApiBuilder.group(
  exampleHttpApi,
  'users',
  Effect.fn(function* (handlers) {
    const { users } = yield* ExampleDomain
    return handlers.handleAll({
      list: () => users.list(),
      get: ({ params, query }) => users.get({ ...params, ...query }),
      create: ({ payload }) => users.create(payload),
      delete: ({ params }) => users.delete(params),
      page: ({ query }) => users.page(query),
    })
  }),
)

const diagnostics = HttpApiBuilder.group(
  exampleHttpApi,
  'diagnostics',
  Effect.fn(function* (handlers) {
    const { diagnostics } = yield* ExampleDomain
    return handlers.handleAll({
      fail: () => diagnostics.fail,
      operationStatus: ({ params }) => diagnostics.operationStatus(params.operationId),
      slow: ({ query }) => diagnostics.slow(query),
      status: () => diagnostics.status,
    })
  }),
)

const authorization = Layer.succeed(
  ExampleHttpAuthorization,
  ExampleHttpAuthorization.of(
    Effect.fn('ExampleHttp.authorization')(function* (effect) {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (request.headers['x-example-authorization'] !== 'allowed') {
        return yield* new ExampleAuthorizationError({ reason: 'missing-example-authorization' })
      }
      return yield* effect
    }),
  ),
)

export const exampleHttpRoutes = HttpApiBuilder.layer(exampleHttpApi).pipe(
  Layer.provide([users, diagnostics]),
  Layer.provide(authorization),
)
