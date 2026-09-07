import {
  exampleRpcGroup,
  ExampleAuthorization,
  ExampleAuthorizationError,
} from '@effect-api-query/contracts'
import { Effect, Layer, Schedule, Stream } from 'effect'

import { ExampleDomain } from './domain.ts'

const diagnosticStream = Stream.concat(
  Stream.make('Connection opened'),
  Stream.make('Permissions loaded', 'Workspace synchronized', 'Ready').pipe(
    Stream.schedule(Schedule.spaced('350 millis')),
  ),
)

const handlersLayer = exampleRpcGroup.toLayer(
  Effect.gen(function* () {
    const { users, diagnostics, commands } = yield* ExampleDomain

    return exampleRpcGroup.of({
      'commands.start': commands.start,
      'commands.status': commands.status,
      'commands.cancel': commands.cancel,
      'diagnostics.cancel': Effect.fn('ExampleRpc.diagnostics.cancel')(
        ({ operationId }: { readonly operationId: string }) => diagnostics.cancel(operationId),
      ),
      'diagnostics.fail': Effect.fn('ExampleRpc.diagnostics.fail')(() => diagnostics.fail),
      'diagnostics.operationStatus': Effect.fn('ExampleRpc.diagnostics.operationStatus')(
        ({ operationId }: { readonly operationId: string }) =>
          diagnostics.operationStatus(operationId),
      ),
      'diagnostics.slow': diagnostics.slow,
      'diagnostics.status': Effect.fn('ExampleRpc.diagnostics.status')(() => diagnostics.status),
      'diagnostics.stream': () => diagnosticStream,
      'testing.reset': Effect.fn('ExampleRpc.testing.reset')(function* () {
        yield* commands.reset
        yield* diagnostics.reset
        yield* users.reset
      }),
      'testing.seed': users.seed,
      'users.create': users.create,
      'users.delete': users.delete,
      'users.get': users.get,
      'users.list': users.list,
      'users.page': users.page,
    })
  }),
)

const authorizationLayer = Layer.succeed(
  ExampleAuthorization,
  ExampleAuthorization.of((effect, { headers }) =>
    headers['x-example-authorization'] === 'allowed'
      ? effect
      : Effect.fail(
          new ExampleAuthorizationError({
            reason: 'missing-example-authorization',
          }),
        ),
  ),
)

export const exampleRpcHandlersLayer = Layer.mergeAll(handlersLayer, authorizationLayer)
