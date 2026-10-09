import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, Layer, Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import { HttpServer, HttpServerResponse } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from 'effect/http-api'
import { equal } from 'node:assert/strict'

const User = Schema.Struct({ id: Schema.Finite, name: Schema.String })
const api = HttpApi.make('etag-recipe').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.FiniteFromString },
      success: User,
    }),
    HttpApiEndpoint.put('update', '/users/:id', {
      params: { id: Schema.FiniteFromString },
      headers: { 'if-match': Schema.String },
      payload: Schema.Struct({ name: Schema.String }),
      success: User,
      error: Schema.Literal('precondition-failed').pipe(HttpApiSchema.status(412)),
    }),
  ),
)
let name = 'Grace'
let revision = 1
const handlers = HttpApiBuilder.group(api, 'users', (group) =>
  group
    .handleRaw('get', ({ params }) =>
      HttpServerResponse.json(
        { id: params.id, name },
        {
          headers: { etag: `"revision-${revision}"` },
        },
      ).pipe(Effect.orDie),
    )
    .handle('update', ({ params, headers, payload }) => {
      if (headers['if-match'] !== `"revision-${revision}"`)
        return Effect.fail('precondition-failed')
      name = payload.name
      revision += 1
      return Effect.succeed({ id: params.id, name })
    }),
)
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(api, ['users'])
      const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['etag'] })
      const queryClient = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => queryClient.clear()))
      yield* Effect.promise(async () => {
        const input = { params: { id: 1 } }
        const metadataOptions = http.users.get.metadataOptions({ input })
        const current = await queryClient.query(metadataOptions)
        const etag = current.headers['etag']
        if (etag === undefined) throw new Error('The server supplied no ETag')

        await queryClient.cancelQueries({ queryKey: http.users.get.key() })
        const update = new MutationObserver(
          queryClient,
          http.users.update.mutationOptions({
            onSuccess: () => queryClient.invalidateQueries({ queryKey: http.users.get.key() }),
          }),
        )
        await update.mutate({
          params: input.params,
          headers: { 'if-match': etag },
          payload: { name: 'Ada' },
        })

        const refreshed = await queryClient.query(metadataOptions)
        equal(current.data.name, 'Grace')
        equal(refreshed.data.name, 'Ada')
        equal(etag, '"revision-1"')
        equal(refreshed.headers['etag'], '"revision-2"')
      })
    }).pipe(Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices))),
  ),
)
