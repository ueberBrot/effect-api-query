---
title: Stream Snapshots
description: Capture an accumulated or live stream for server rendering and hydrate an independent browser cache.
---

Use `fetchStreamSnapshot` when server rendering needs data from an open RPC or HTTP SSE query. The helper waits for the first new cache publication or normal completion. It cancels the exact query and awaits local iterator cleanup. Ordinary `queryClient.query` waits for an open stream to finish.

## Capture data before dehydration

Import `fetchStreamSnapshot` from `@ueberbrot/effect-api-query`. In the request loader or server snapshot module, use your existing `rpc`, request-local `queryClient` and abort `signal`. Keep the ready client and runner alive until capture settles. For the declared `updates.watch` stream:

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

In the same request, capture the independent latest-value view:

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

Dehydrate successful data with your application's serializer. After cleanup, dispose the request resources. HTTP SSE accepts the same helper with its generated options. The [complete typed recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-stream-snapshot.ts) includes the contract and client setup. [Hydrate Query Views](/effect-api-query/guides/hydrate-query-views/) covers history, live values, and paired codecs.

The default `fresh` mode starts a new attempt even when cached or initial data has a future timestamp. Old data cannot settle that attempt. Native stream policies still apply: `append` includes existing history, and `replace` on a previously fetched query publishes only at completion. An open replacement stream therefore needs to complete or reach the timeout.

Choose `mode: 'cached'` to return an existing successful value without starting or cancelling work. The helper applies native `select`, including QueryClient defaults. When no successful cache entry exists, cached mode starts a fresh capture.

## Keep capture ownership exclusive

Use a request-local QueryClient and reserve the exact key throughout capture. A fresh capture rejects a key that is fetching, paused, or observed. Other keys keep running. Until capture settles, avoid writes, observers, or concurrent fetches on that key. An external `setQueryData` publication can be mistaken for the stream's first value.

Configure hashing through QueryClient global or prefix defaults. The helper rejects per-call `queryHash` and `queryKeyHashFn`.

The helper waits for the supplied query function to finish local cleanup before returning or rejecting. After capture settles, dispose the server's ready client, Scope, or runtime. Capture does not await a remote server's cancellation acknowledgement. A finalizer that never finishes prevents settlement. `timeoutMs` limits the wait for data and does not limit finalization.

A local stream finalizer failure rejects capture with the adapter's execution error and preserved Cause, even after data was published.

## Hydrate and reconnect in the browser

Give the browser its own QueryClient, ready client, runner, and Scope. Hydrate the server snapshot using the same safe key prefix and input. Then observe the generated stream options with your usual refetch policy. A new browser fetch reconnects with browser-owned resources. Disposing the server's resources cannot dispose the browser's resources.

The [TanStack Start example](/effect-api-query/guides/tanstack-start/) captures server snapshots and reconnects accumulated and live views after hydration. The [helper reference](/effect-api-query/reference/public-exports/#fetchstreamsnapshot) defines timeout, abort, failure, empty-stream, and completion outcomes.
