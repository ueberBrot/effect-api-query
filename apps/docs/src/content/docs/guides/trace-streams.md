---
title: Trace Stream Consumption
description: Keep an application span open through HTTP SSE pulls and asynchronous iterator cleanup.
---

Configure telemetry in the app runtime. Trace the stream returned by the ready client so the span covers each pull and cleanup. A span around `runPromiseExit` ends when the iterable is ready.

## Define the shared feed contract

Save the declaration as `feed-contract.ts` and import it on both sides of `GET /events`.

```ts
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";

export const feedApi = HttpApi.make("feed-api").add(
  HttpApiGroup.make("events").add(
    HttpApiEndpoint.get("watch", "/events", {
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
    })
  )
);
```

## Attach a span to the decoded stream

In `trace-feed.ts`, wrap decoded streams and pass other responses through. HttpApiClient applies this transformation before it wraps the response in the requested mode. If your API declares decoded response headers, preserve their wrapper.

```ts
import { QueryClient } from "@tanstack/query-core";
import {
  createHttpApiQueryUtils,
  fetchStreamSnapshot,
} from "@ueberbrot/effect-api-query";
import type { RunPromiseExit } from "@ueberbrot/effect-api-query";
import { Effect, Layer, ManagedRuntime, Stream, Tracer } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { OtlpSerialization, OtlpTracer } from "effect/observability";

import { feedApi } from "./feed-contract.ts";

export const traceFeed = <A, E, R>(source: Stream.Stream<A, E, R>) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const span = yield* Effect.makeSpanScoped("events.watch.consume", {
        attributes: { "api.id": "feed-api", endpoint: "watch" },
      });
      return source.pipe(
        Stream.tap(() =>
          Effect.sync(() => span.attribute("feed.received", true))
        ),
        Stream.ensuring(
          Effect.sync(() => span.attribute("feed.cleanup", true))
        ),
        Stream.provideService(Tracer.ParentSpan, span)
      );
    })
  );

const traceDecodedResponse = (
  effect: Effect.Effect<unknown, unknown, unknown>
) =>
  effect.pipe(
    Effect.map((value) => (Stream.isStream(value) ? traceFeed(value) : value))
  );
```

`Stream.unwrap` opens the scoped span when consumption starts. Its ParentSpan places pull work under that span. The finalizer updates the captured span directly, then the span closes after local cleanup. This includes asynchronous cancellation cleanup.

The span records the declared API and endpoint, receipt, and cleanup. Keep emitted data, request input, and credentials out of these attributes.

## Supply the runtime and await cleanup

In `trace-feed.ts`, configure Effect's OTLP exporter with your collector URL, such as its `/v1/traces` endpoint. The function acquires the client and supplies a runner that forwards the signal. The snapshot helper captures one live value, closes the iterator, and waits for cleanup before disposing of the runtime.

```ts
const captureTracedFeed = async (
  baseUrl: string,
  collectorUrl: string,
  signal: AbortSignal
) => {
  const telemetry = OtlpTracer.layer({
    url: collectorUrl,
    resource: { serviceName: "users-browser" },
  }).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer)
  );
  const runtime = ManagedRuntime.make(
    Layer.merge(FetchHttpClient.layer, telemetry)
  );
  const queryClient = new QueryClient();
  try {
    const client = await runtime.runPromise(
      HttpApiClient.make(feedApi, {
        baseUrl,
        transformResponse: traceDecodedResponse,
      })
    );
    const runPromiseExit: RunPromiseExit = (effect, options) =>
      runtime.runPromiseExit(effect, options);
    const http = createHttpApiQueryUtils(feedApi, {
      client,
      keyPrefix: ["feed-app"],
      runPromiseExit,
    });
    return await fetchStreamSnapshot(
      queryClient,
      http.events.watch.liveOptions({ retry: false }),
      {
        signal,
        timeoutMs: 5_000,
      }
    );
  } finally {
    try {
      await queryClient.cancelQueries();
    } finally {
      queryClient.clear();
      await runtime.dispose();
    }
  }
};
```

Call `captureTracedFeed` with your API base URL, collector URL, and abort signal. If you run it in a browser, allow that origin on the collector. The app controls telemetry. The same response transformation works for both accumulated and live SSE.

For RPC, wrap the stream in your client and transport integration. Preserve the flat client's request options and queue modes. Configure Effect RPC's native client spans during acquisition.

Keep the browser runtime alive until the finalizer finishes. `cancelQueries` can settle first. See [stream snapshots](/effect-api-query/guides/stream-snapshots/) for finite capture and [client lifecycle](/effect-api-query/concepts/client-lifecycle/) for ongoing feeds.
