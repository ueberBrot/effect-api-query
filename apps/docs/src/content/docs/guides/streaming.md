---
title: Streaming
description: Cache accumulated or latest values from RPC streams and HTTP SSE or NDJSON.
---

Streaming leaves provide two views. An accumulated streamed query caches emissions in order. A live query caches the latest value. Use ordinary query hooks or `QueryObserver` for both. Start with a ready [RPC](/effect-api-query/getting-started/quick-start/) or [HTTP](/effect-api-query/getting-started/http-quick-start/) utility tree. Here, `diagnostics.stream` is an inputless RPC emitting strings, and `events.watch` is an HTTP SSE endpoint declaring `query.channel` and emitting strings.

## Accumulate values

Choose a finite history for a long-running feed:

```ts
const history = rpc.diagnostics.stream.streamedOptions({
  maxChunks: 100,
  refetchMode: "reset",
});
```

HTTP SSE supports the same history controls and a separate decoder limit:

```ts
const sseHistory = http.events.watch.streamedOptions({
  input: { query: { channel: "news" } },
  maxChunks: 100,
  sseOptions: { maxEventSize: 1024 * 1024 },
});
```

The first emission makes the query successful while fetching continues. A finite `maxChunks` bounds cached elements after each publication. Choose `"unbounded"` explicitly to retain every emission, or inherit retention through `configureUtils` with `streamed.policy`. It does not bound bytes or transport buffering.

Refetch mode `reset` starts a new history, `append` adds to it, and `replace` keeps the old history until successful completion. An indefinitely open replacement keeps showing that old history. Accumulated streams can succeed without emissions.

For a high-rate feed, set `publicationBatchSize` to a positive safe integer. The first event publishes immediately. Later events publish in ordered batches. Completion or failure flushes a partial batch; a `replace` refetch still publishes only after successful completion. Cancellation discards unpublished events and follows native cache reversion.

The default of one publishes every event. Larger values count events without setting a timer, so a paused stream can leave a partial batch unpublished indefinitely. Use one when each event must appear promptly. See [Batch Accumulated Publications](/effect-api-query/guides/choose-stream-history/#batch-accumulated-publications) for an example and cache-identity rules.

## Keep the latest value

Choose live options for current state:

```ts
const latest = rpc.diagnostics.stream.liveOptions();
const latestSse = http.events.watch.liveOptions({
  input: { query: { channel: "news" } },
  sseOptions: { maxEventSize: 1024 * 1024 },
});
```

Each emission replaces cached data. Completion preserves that data. Live queries convert top-level `undefined` to `null`, while accumulated elements retain `undefined`. Empty live completion raises the adapter's empty-stream error. Live options accept no `maxChunks`, `refetchMode`, or `publicationBatchSize`.

## Consume NDJSON records

An endpoint with exactly one `HttpApiSchema.StreamNdjson` success supports both views, including a declared `WithHeaders` wrapper. Effect parses frames and decodes records. Pass a ready client for the same declaration:

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

Pass `history` or `latest` to a native query hook or QueryClient. A wire record `{"id":"1"}` becomes `{ id: 1 }`. NDJSON uses the same retention, publication, empty-completion, cancellation, and snapshot behavior as other decoded streams. It accepts no `sseOptions` and has no SSE decoder key fields. Configure `maxElementBytes` on the Effect declaration. Keep the client and runner alive through consumption and cleanup.

## Address and stop a view

For exact cache access, reuse the options' `queryKey`. Accumulated history policies and SSE decoder policies affect identity. Live and accumulated views remain separate. Endpoint prefixes match all their views.

The adapter publishes both views through stable Query Core cache operations. Native cache reads, writes, observers, and structural-sharing overrides use the same cache entry.

Cancellation closes the stream iterator. Your application owns reconnection, resume policy, and client lifetime. Use [Reconnect Streams](/effect-api-query/guides/reconnect-streams/) to add `recoverStream` to application-owned delivery when the server supports ordered cursor replay. A replacement stream can start while the old iterator's asynchronous finalizer is still pending. See [Release Resources after Local Cleanup](/effect-api-query/guides/cancellation/#release-resources-after-local-cleanup) when streams share exclusive resources.

HTTP `sseOptions.maxEventSize` bounds pending parser text in JavaScript string code units. Its default is 10 × 1024 × 1024 code units. Put declared resume headers in `input.headers`.

Set `sseOptions.dispatchEmptyNamedEvents` to `true` for named events without a `data:` line, when the endpoint's SSE declaration accepts them. It defaults to `false`. Changing this option selects a different cache entry.

See [Choose Stream History](/effect-api-query/guides/choose-stream-history/) for retention and buffering, [Stream Snapshots](/effect-api-query/guides/stream-snapshots/) for finite server captures, and [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for cleanup ownership.
