---
title: Stream Snapshots
description: Capture an accumulated or live stream for server rendering and hydrate an independent browser cache.
---

Use `fetchStreamSnapshot` when server rendering needs data from an open RPC or HTTP SSE query.
It waits for the first new cache publication or normal completion, cancels the exact query, and
awaits its local iterator cleanup. Ordinary `queryClient.query` waits for an open stream to finish.

## Capture data before dehydration

Pass generated accumulated or live options to the helper. Keep the ready client and runner alive
until the returned Promise settles. This example captures separate history and latest-value views:

```ts
import type { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createRpcQueryUtils, fetchStreamSnapshot } from 'effect-api-query'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'

export const updates = RpcGroup.make(
  Rpc.make('updates.watch', {
    payload: { channel: Schema.String },
    success: Schema.String,
    stream: true,
  }),
)

export async function captureUpdates<E>(
  queryClient: QueryClient,
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof updates>, E>,
  signal: AbortSignal,
) {
  const rpc = createRpcQueryUtils<typeof updates, readonly ['updates'], E>(updates, {
    client,
    keyPrefix: ['updates'],
  })
  const input = { channel: 'announcements' }
  const history = await fetchStreamSnapshot(
    queryClient,
    rpc.updates.watch.streamedOptions({
      input,
      retry: false,
      maxChunks: 20,
    }),
    { signal, timeoutMs: 5_000 },
  )
  const latest = await fetchStreamSnapshot(
    queryClient,
    rpc.updates.watch.liveOptions({
      input,
      retry: false,
    }),
    { signal, timeoutMs: 5_000 },
  )
  return { history, latest }
}
```

Call `captureUpdates` with a request-local QueryClient, ready client, and request abort signal.
Then dehydrate successful data with TanStack's normal policy and your application's serializer.
For HTTP SSE, pass `streamedOptions` or `liveOptions` from the HTTP utility tree in the same way.
Use [Hydrate Unary Data](/effect-api-query/guides/hydrate-unary-data/) for paired Schema codecs,
including accumulated arrays and live values.

The default `fresh` mode starts a new attempt even when cached or initial data has a future
timestamp. Old data cannot settle that attempt. Native stream policies still apply: `append`
includes existing history, and `replace` on a previously fetched query publishes only at completion.
An open replacement stream therefore needs to complete or reach the timeout.

Choose `mode: 'cached'` to return an existing successful value without starting or cancelling work.
The helper applies native `select`, including QueryClient defaults. When no successful cache entry
exists, cached mode starts a fresh capture.

## Keep capture ownership exclusive

Use a request-local QueryClient and reserve the exact key throughout capture. A fresh capture
rejects a key that is fetching, paused, or observed. Other keys keep running. Avoid same-key writes,
observers, or concurrent fetches until capture settles: an external `setQueryData` publication can
otherwise be mistaken for the stream's first value. Configure hashing through QueryClient global
or prefix defaults; per-call `queryHash` and `queryKeyHashFn` are rejected.

The helper waits for the supplied query function to finish local cleanup before returning or rejecting.
Dispose the server's ready client, Scope, or runtime after that settlement. This does not await a
remote server's cancellation acknowledgement. A finalizer that never finishes also prevents
settlement; `timeoutMs` limits the wait for data, not the duration of finalization.

## Hydrate and reconnect in the browser

Give the browser its own QueryClient, ready client, runner, and Scope. Hydrate the server snapshot
using the same safe key prefix and input, then observe the generated stream options with your
usual refetch policy. A new browser fetch reconnects with browser-owned resources; disposing the
server's resources cannot dispose those resources.

The [TanStack Start example](/effect-api-query/guides/tanstack-start/) captures server snapshots
and reconnects accumulated and live views after hydration. The
[helper reference](/effect-api-query/reference/public-exports/#fetchstreamsnapshot) defines timeout,
abort, failure, empty-stream, and completion outcomes.
