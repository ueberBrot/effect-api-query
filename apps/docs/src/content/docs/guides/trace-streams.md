---
title: Trace Stream Consumption
description: Keep an application span open through HTTP SSE pulls and asynchronous iterator cleanup.
---

Configure telemetry in your application runtime. Instrument the stream that the ready client
returns. A span around the `runPromiseExit` creation Effect ends when that Effect returns the
iterable. Stream pulls happen later and need their own span.

## Define the shared feed contract

Place the string SSE feed declaration in `feed-contract.ts`. The server and client import the
same contract for `GET /events`.

Shared contract in `feed-contract.ts`:

```ts
import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'

export const feedApi = HttpApi.make('feed-api').add(
  HttpApiGroup.make('events').add(
    HttpApiEndpoint.get('watch', '/events', {
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
    }),
  ),
)
```

## Attach a span to the decoded stream

In `trace-feed.ts`, the response transformation wraps only decoded streams. It passes other values
through. HttpApiClient applies the transformation before response-mode wrapping, so the client
retains its native request options and response contract. If your API declares header-wrapped
stream schemas, keep them intact. This feed has no decoded header wrapper.

Client tracing in `trace-feed.ts`:

```ts
import { QueryClient } from '@tanstack/query-core'
import { Effect, Layer, ManagedRuntime, Stream, Tracer } from 'effect'
import { createHttpApiQueryUtils, fetchStreamSnapshot } from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import { FetchHttpClient } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'
import { OtlpSerialization, OtlpTracer } from 'effect/observability'

import { feedApi } from './feed-contract.ts'

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

`Stream.unwrap` acquires the scoped span when consumption begins. Its ParentSpan makes nested
pull work a child of that span. The finalizer updates the captured span directly. It does not
depend on a pull fiber's current-span context. The span closes after local stream finalizers
finish, including asynchronous cancellation cleanup.

The attributes identify the declared API and endpoint. The example records receipt and cleanup
without exporting emitted data, request input, or credentials.

## Supply the runtime and await cleanup

Continue in `trace-feed.ts`. Use Effect's OTLP tracer with an exporter URL, such as your
collector's `/v1/traces` endpoint. The function configures a runtime and acquires the ready client.
It injects a runner that forwards the signal and captures one live value. The snapshot helper
stops the iterator and awaits local cleanup before disposal releases the runtime.

Client capture in `trace-feed.ts`, continued:

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
and span policy belong to the application. The package does not install an exporter or log by default.
The same response transformation covers accumulated and live HTTP SSE views.

For RPC streams, instrument the stream in the application's client and transport integration while
preserving the flat client's request options and queue modes. Effect RPC also creates native
client spans when tracing is enabled. Configure those spans and telemetry during client
acquisition. A wrapper around iterable creation alone does not cover later consumption.

For an open browser feed, keep the runtime alive until the local stream finalizer signals completion.
Native `cancelQueries` can settle before asynchronous cleanup finishes. Use
[Stream Snapshots](/effect-api-query/guides/stream-snapshots/) for finite capture and
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for long-lived ownership.
