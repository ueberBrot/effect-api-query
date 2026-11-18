---
title: Stream Snapshots
description: Capture an accumulated or live stream for server rendering and hydrate an independent browser cache.
---

Use `fetchStreamSnapshot` to get data from an open stream before server rendering. It waits for the first new cache publication or completion, then waits for local iterator cleanup. Ordinary `queryClient.query` waits for the stream to finish.

## Capture data before dehydration

Import `fetchStreamSnapshot` from `@ueberbrot/effect-api-query`. Use the request's own QueryClient and abort signal. Keep the ready client and runner alive until the capture returns or throws.

```ts
const input = { channel: "announcements" };
const history = await fetchStreamSnapshot(
  queryClient,
  rpc.updates.watch.streamedOptions({
    input,
    retry: false,
    maxChunks: 20,
  }),
  { signal, timeoutMs: 5_000 }
);
```

Capture the latest-value view under its own key.

```ts
const latest = await fetchStreamSnapshot(
  queryClient,
  rpc.updates.watch.liveOptions({
    input,
    retry: false,
  }),
  { signal, timeoutMs: 5_000 }
);
```

Dehydrate the result with your serializer. Dispose of request resources after cleanup. The same helper works with HTTP SSE and NDJSON options. See the [complete example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-stream-snapshot.ts) and [view codecs](/effect-api-query/guides/hydrate-query-views/).

The default `fresh` mode starts a new attempt even if the cache has fresh or initial data. It waits for a new publication. An `append` refetch includes existing history. A `replace` refetch on a previously fetched query publishes only at completion. An open replacement must finish or reach the timeout.

Use `mode: 'cached'` to read a successful entry without starting or cancelling work. The helper applies native `select`, including defaults. If there is no successful entry, it starts a fresh capture.

## Keep capture ownership exclusive

Reserve the exact key in a request-local QueryClient. Fresh capture rejects a key that is fetching, paused, or observed. Other keys can keep running. Avoid concurrent writes, observers, and fetches on the reserved key. An external `setQueryData` call can look like the first stream publication.

Configure hashing through QueryClient global or prefix defaults. The helper rejects per-call `queryHash` and `queryKeyHashFn`.

Wait for capture to settle before disposing of the client, Scope, or runtime. `timeoutMs` limits how long the helper waits for data. The helper still waits for the query function's cleanup, so a stuck finalizer can block settlement. Wait for a server acknowledgement separately if you need one.

If a local finalizer fails, capture rejects with the execution error and its Cause even after publication.

## Hydrate and reconnect in the browser

Give the browser its own QueryClient, client, runner, and Scope. Hydrate using the same safe prefix and input. Observe the generated options with your refetch policy. A fresh browser fetch uses the browser's client.

See [TanStack Start](/effect-api-query/guides/tanstack-start/) for capture and browser reconnection. See the [helper reference](/effect-api-query/reference/public-exports/#fetchstreamsnapshot) for abort, timeout, failure, and completion outcomes.
