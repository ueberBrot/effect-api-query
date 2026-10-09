import { it } from '@effect/vitest'
import { QueryClient } from '@tanstack/query-core'
import { Effect, Layer, Schema, Stream } from 'effect'
import { HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from 'effect/http-api'
import { expect } from 'vite-plus/test'

import { createHttpApiQueryUtils, EffectHttpApiQueryEmptyStreamError } from '#effect-api-query'

const api = HttpApi.make('empty-live').add(
  HttpApiGroup.make('events').add(
    HttpApiEndpoint.get('watch', '/watch', {
      success: HttpApiSchema.StreamSse({ data: Schema.Finite }),
    }),
  ),
)
const handlers = HttpApiBuilder.group(api, 'events', (group) =>
  group.handle('watch', () => Effect.succeed(Stream.empty)),
)

it.effect('reports declaration identity when an HTTP live stream completes without an event', () =>
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(api, ['events'])
    const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['test'] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    try {
      yield* Effect.promise(async () => {
        const pending = queryClient.query(http.events.watch.liveOptions())
        await expect(pending).rejects.toBeInstanceOf(EffectHttpApiQueryEmptyStreamError)
        await expect(pending).rejects.toMatchObject({
          _tag: 'EffectHttpApiQueryEmptyStreamError',
          apiId: 'empty-live',
          groupId: 'events',
          endpoint: 'watch',
          method: 'GET',
          operation: 'live',
        })
      })
    } finally {
      queryClient.clear()
    }
  }).pipe(Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)), Effect.scoped),
)
