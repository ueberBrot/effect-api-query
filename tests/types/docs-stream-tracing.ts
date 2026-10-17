import { QueryClient } from '@tanstack/query-core'
import { createHttpApiQueryUtils, fetchStreamSnapshot } from '@ueberbrot/effect-api-query'
import type { RunPromiseExit } from '@ueberbrot/effect-api-query'
import { Effect, Layer, ManagedRuntime, Stream, Tracer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'
import { OtlpSerialization, OtlpTracer } from 'effect/observability'

import { feedApi } from './docs-stream-tracing-contract.ts'

export const traceFeed = <A, E, R>(source: Stream.Stream<A, E, R>) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const span = yield* Effect.makeSpanScoped('events.watch.consume', {
        attributes: { 'api.id': 'feed-api', endpoint: 'watch' },
      })
      return source.pipe(
        Stream.tap(() => Effect.sync(() => span.attribute('feed.received', true))),
        Stream.ensuring(Effect.sync(() => span.attribute('feed.cleanup', true))),
        Stream.provideService(Tracer.ParentSpan, span),
      )
    }),
  )

const traceDecodedResponse = (effect: Effect.Effect<unknown, unknown, unknown>) =>
  effect.pipe(Effect.map((value) => (Stream.isStream(value) ? traceFeed(value) : value)))

const captureTracedFeed = async (baseUrl: string, collectorUrl: string, signal: AbortSignal) => {
  const telemetry = OtlpTracer.layer({
    url: collectorUrl,
    resource: { serviceName: 'users-browser' },
  }).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer))
  const runtime = ManagedRuntime.make(Layer.merge(FetchHttpClient.layer, telemetry))
  const queryClient = new QueryClient()
  try {
    const client = await runtime.runPromise(
      HttpApiClient.make(feedApi, { baseUrl, transformResponse: traceDecodedResponse }),
    )
    const runPromiseExit: RunPromiseExit = (effect, options) =>
      runtime.runPromiseExit(effect, options)
    const http = createHttpApiQueryUtils(feedApi, {
      client,
      keyPrefix: ['feed-app'],
      runPromiseExit,
    })
    return await fetchStreamSnapshot(queryClient, http.events.watch.liveOptions({ retry: false }), {
      signal,
      timeoutMs: 5_000,
    })
  } finally {
    try {
      await queryClient.cancelQueries()
    } finally {
      queryClient.clear()
      await runtime.dispose()
    }
  }
}
