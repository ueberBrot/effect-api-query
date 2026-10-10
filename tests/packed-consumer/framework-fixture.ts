import { Effect, Exit, Schema, Scope, Stream } from 'effect'
import { createRpcQueryUtils, createHttpApiQueryUtils } from 'effect-api-query'
import { HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiBuilder,
  HttpApiTest,
} from 'effect/http-api'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'

export const expectEqual = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}
export const waitFor = (check: () => boolean, message: string) =>
  new Promise<void>((resolve, reject) => {
    const deadline = performance.now() + 10_000
    const checkFrame = () => {
      if (check()) resolve()
      else if (performance.now() >= deadline) reject(new Error(message))
      else requestAnimationFrame(checkFrame)
    }
    checkFrame()
  })
const Watch = Rpc.make('values.watch', {
  payload: { id: Schema.Int },
  success: Schema.Int,
  stream: true,
})
const group = RpcGroup.make(Watch)
const api = HttpApi.make('framework-runtime').add(
  HttpApiGroup.make('values').add(
    HttpApiEndpoint.get('watch', '/watch/:id', {
      params: { id: Schema.FiniteFromString },
      success: HttpApiSchema.StreamSse({ data: Schema.Int }),
    }),
    HttpApiEndpoint.get('read', '/read/:id', {
      params: { id: Schema.FiniteFromString },
      success: Schema.Int.pipe(HttpApiSchema.status(203)),
    }),
  ),
)
export const makeFixture = async (name: string) => {
  const scope = Scope.makeUnsafe()
  const finalized: number[] = []
  const client = await Effect.runPromise(
    RpcTest.makeClient(group, { flatten: true }).pipe(
      Effect.provide(
        group.toLayer({
          'values.watch': ({ id }) =>
            Stream.unwrap(
              Effect.acquireRelease(
                Effect.succeed(
                  Stream.succeed(id).pipe(Stream.concat(Stream.fromEffect(Effect.never))),
                ),
                () =>
                  Effect.sync(() => {
                    finalized.push(id)
                  }),
              ),
            ),
        }),
      ),
      Scope.provide(scope),
    ),
  )
  const utils = createRpcQueryUtils(group, { client, keyPrefix: [name] })
  const httpFinalized: number[] = []
  const httpClient = await Effect.runPromise(
    HttpApiTest.groups(api, ['values']).pipe(
      Effect.provide(
        HttpApiBuilder.group(api, 'values', (handlers) =>
          handlers
            .handle('read', ({ params }) => Effect.succeed(params.id))
            .handle('watch', ({ params }) =>
              Effect.succeed(
                Stream.unwrap(
                  Effect.acquireRelease(
                    Effect.succeed(
                      Stream.succeed(params.id).pipe(
                        Stream.concat(Stream.fromEffect(Effect.never)),
                      ),
                    ),
                    () =>
                      Effect.sync(() => {
                        httpFinalized.push(params.id)
                      }),
                  ),
                ),
              ),
            ),
        ),
      ),
      Effect.provide(HttpServer.layerServices),
      Scope.provide(scope),
    ),
  )
  const http = createHttpApiQueryUtils(api, { client: httpClient, keyPrefix: [name] })
  return {
    utils,
    http,
    finalized,
    httpFinalized,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}
