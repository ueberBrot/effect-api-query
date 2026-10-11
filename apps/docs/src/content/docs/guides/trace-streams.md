---
title: Trace Stream Consumption
description: Keep an application span open through HTTP SSE pulls and asynchronous iterator cleanup.
---

Configure telemetry in the application's runtime and instrument the stream that a ready client
returns. A span around the `runPromiseExit` creation Effect ends when it returns the iterable.
Actual stream pulls happen later; they need their own span.

## Attach a span to the decoded stream

This client module declares a string SSE feed at `GET /events`. Its response transformation wraps
only decoded streams and passes other values through. HttpApiClient applies that transformation
before response-mode wrapping, so the client retains its native request options and response
contract. Keep header-wrapped stream schemas intact if your API declares them; this simple feed
has no decoded header wrapper.

```ts
import { QueryClient } from '@tanstack/query-core'
import { Effect, Layer, ManagedRuntime, Schema, Stream, Tracer } from 'effect'
import { createHttpApiQueryUtils, fetchStreamSnapshot } from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import { FetchHttpClient } from 'effect/http'
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api'
import { OtlpSerialization, OtlpTracer } from 'effect/observability'

const feedApi = HttpApi.make('feed-api').add(
  HttpApiGroup.make('events').add(
    HttpApiEndpoint.get('watch', '/events', {
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
    }),
  ),
)

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
```

`Stream.unwrap` acquires the scoped span when consumption begins. Providing its ParentSpan
makes nested pull work a child of that span. The finalizer updates the captured span directly,
so it does not depend on a pull fiber's current-span context. The span closes after local stream
finalizers finish, including asynchronous cancellation cleanup.

The attributes identify the declared API and endpoint. The example records receipt and cleanup
without exporting emitted data, request input, or credentials.

## Supply the runtime and await cleanup

Use Effect's OTLP tracer with an exporter URL, such as your collector's `/v1/traces` endpoint.
This function configures a runtime, acquires the ready client, injects a signal-aware runner,
and captures one live value. Its snapshot helper stops the iterator and awaits local cleanup
before the runtime is disposed.

```ts
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
```

Call `captureTracedFeed` with your API base URL, collector URL, and an application-owned
AbortSignal. A browser collector needs to accept that browser's requests. The telemetry layer
and span policy belong to the application; the package does not install an exporter or log by default.
The same response transformation covers accumulated and live HTTP SSE views.

For RPC streams, instrument the stream in the application's client/transport integration while
preserving the flat client's request options and queue modes. Effect RPC also creates native
client spans when tracing is enabled. Configure those spans and telemetry during client
acquisition; wrapping only iterable creation still does not cover later consumption.

For an open browser feed, keep the runtime alive until the local stream finalizer signals completion.
Native `cancelQueries` can settle before asynchronous cleanup finishes. Use
[Stream Snapshots](/effect-api-query/guides/stream-snapshots/) for finite capture and
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for long-lived ownership.
