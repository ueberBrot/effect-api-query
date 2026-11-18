---
title: Streaming
description: Cache accumulated or latest values from RPC streams and HTTP SSE or NDJSON.
---

Use an accumulated streamed query to cache events in order. Use a live query to cache only the latest value. Pass either to an ordinary query hook or a `QueryObserver`. Start with the utilities from the [RPC](/effect-api-query/getting-started/quick-start/) or [HTTP](/effect-api-query/getting-started/http-quick-start/) quick start.

## Accumulate values

This inputless RPC emits strings. Use a finite history for a long-running feed.

```ts
const history = rpc.diagnostics.stream.streamedOptions({
  maxChunks: 100,
  refetchMode: "reset",
});
```

This SSE endpoint takes `query.channel` and emits strings. Set its parser limit separately from history retention.

```ts
const sseHistory = http.events.watch.streamedOptions({
  input: { query: { channel: "news" } },
  maxChunks: 100,
  sseOptions: { maxEventSize: 1024 * 1024 },
});
```

The first value makes the query successful while fetching continues. A finite `maxChunks` limits how many elements remain after each publication. Set it directly or through `configureUtils` under `streamed.policy`. To keep every value, choose `"unbounded"`. The bound applies to cached elements. Configure byte limits and buffering separately.

Choose `reset` to start a new history, `append` to add to the existing history, or `replace` to publish after successful completion. An open replacement keeps showing the old history. An accumulated stream can succeed without emitting a value.

For a fast feed, set `publicationBatchSize` to publish groups of events. The first event publishes immediately. See [batch publications](/effect-api-query/guides/choose-stream-history/#batch-accumulated-publications) for deadlines, failure, and cancellation.

## Keep the latest value

Use live options for the latest state.

```ts
const latest = rpc.diagnostics.stream.liveOptions();
const latestSse = http.events.watch.liveOptions({
  input: { query: { channel: "news" } },
  sseOptions: { maxEventSize: 1024 * 1024 },
});
```

Each emission replaces the cached value by default. To combine updates from complete snapshots, [set a coalescing interval](/effect-api-query/guides/choose-stream-history/#coalesce-complete-live-snapshots). Completion keeps the last value. A live stream that ends without emitting raises an [empty-stream error](/effect-api-query/reference/errors/). Live queries convert `undefined` to `null`. Accumulated streams retain the original value.

## Consume NDJSON records

An endpoint with one `HttpApiSchema.StreamNdjson` success supports both views, including a declared `WithHeaders` wrapper. Effect parses and decodes each record. Acquire the client from the same declaration.

```ts
import { createHttpApiQueryUtils } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";

const recordsApi = HttpApi.make("records-api").add(
  HttpApiGroup.make("records").add(
    HttpApiEndpoint.get("watch", "/records", {
      success: HttpApiSchema.StreamNdjson({
        schema: Schema.Struct({ id: Schema.FiniteFromString }),
        maxElementBytes: "1 MiB",
      }),
    })
  )
);

function recordOptions(client: HttpApiClient.ForApi<typeof recordsApi>) {
  const http = createHttpApiQueryUtils(recordsApi, {
    client,
    keyPrefix: ["records-app"],
  });
  return {
    history: http.records.watch.streamedOptions({ maxChunks: 100 }),
    latest: http.records.watch.liveOptions(),
  };
}
```

Pass `history` or `latest` to a native observer or QueryClient. The wire record `{"id":"1"}` becomes `{ id: 1 }`. NDJSON follows the same query and cleanup rules as other decoded streams. Set `maxElementBytes` on the declaration. Use `sseOptions` only for SSE.

## Address and stop a view

Use the options' `queryKey` for exact cache access. Accumulated and live views have separate keys. History and SSE decoder settings can also affect the key. The endpoint prefix matches every view.

Native reads, writes, observers, and structural-sharing overrides use the same Query Core cache.

Cancellation closes the iterator. Your app controls reconnection, resume, and disposal. If the server supports replay, see [reconnect streams](/effect-api-query/guides/reconnect-streams/). If old and new streams share a resource, see [local cleanup](/effect-api-query/guides/cancellation/#release-resources-after-local-cleanup) before replacing it.

`sseOptions.maxEventSize` limits pending parser text in JavaScript string code units. It defaults to 10 × 1024 × 1024. Put declared resume headers in `input.headers`.

If the SSE declaration accepts named events without a `data:` line, set `sseOptions.dispatchEmptyNamedEvents` to `true` to emit them. The default is `false`. Each setting has a different key.

See [stream history](/effect-api-query/guides/choose-stream-history/) for retention and buffering, [stream snapshots](/effect-api-query/guides/stream-snapshots/) for server captures, and [client lifecycle](/effect-api-query/concepts/client-lifecycle/) for cleanup.
