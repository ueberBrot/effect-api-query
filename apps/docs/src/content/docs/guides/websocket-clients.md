---
title: WebSocket ready clients
description: Acquire a shared RPC connection and keep cancellation and replacement application-owned.
---

Acquire a flat Effect RPC client inside an application Scope, then pass it to
`createRpcQueryUtils`. The same connection can carry concurrent unary requests,
accumulated streamed queries, and live queries. Each request retains its own query key
and cancellation.

## Acquire the connection

Save this module as `socket-client.ts`, and replace `socketGroup` with your shared contract.
Keep the parent Scope alive while any returned utility is in use. The child Scope owns
the socket, protocol, ready client, and QueryClient cleanup.

```ts
import { QueryClient } from '@tanstack/query-core'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'

export const socketGroup = RpcGroup.make(
  Rpc.make('values.read', { payload: { id: Schema.Int }, success: Schema.Int }),
  Rpc.make('values.watch', {
    payload: { channel: Schema.String },
    success: Schema.Int,
    stream: true,
  }),
)

export const acquireSocketQueries = Effect.fn('acquireSocketQueries')(function* (
  url: string,
  owner: string,
) {
  const clientScope = yield* Scope.fork(yield* Effect.scope, 'sequential')
  const socket = yield* Socket.makeWebSocket(url).pipe(Scope.provide(clientScope))
  const protocol = yield* Layer.buildWithScope(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(Layer.succeed(Socket.Socket, socket)),
    ),
    clientScope,
  )
  const client = yield* RpcClient.make(socketGroup, { flatten: true }).pipe(
    Effect.provide(protocol),
    Scope.provide(clientScope),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rpc = createRpcQueryUtils(socketGroup, { client, keyPrefix: ['socket', owner] })
  yield* Scope.addFinalizer(
    clientScope,
    Effect.promise(async () => {
      await queryClient.cancelQueries()
      queryClient.clear()
    }),
  )
  return { client, rpc, queryClient, dispose: Scope.close(clientScope, Exit.void) }
})
```

Supply a WebSocket constructor for the host. Browsers can use
`Socket.layerWebSocketConstructorGlobal`; Node applications can supply the existing
`NodeSocket.layerWebSocketConstructorWS` from `@effect/platform-node`.
The server must expose the matching group through `RpcServer.toHttpEffectWebsocket`
and use the same serialization. This recipe uses JSON on both ends.

## Read and capture stream data

The following browser function runs two unary reads, then captures the first successful
value from each stream view. Run it within a caller-owned Scope. `fetchStreamSnapshot`
stops and drains local iterator work before returning, so an open stream can supply a
snapshot without waiting for completion.

```ts
import { Effect } from 'effect'
import { fetchStreamSnapshot } from 'effect-api-query'
import { Socket } from 'effect/socket'

import { acquireSocketQueries } from './socket-client.ts'

export const readSocketSnapshot = Effect.fn('readSocketSnapshot')(function* (url: string) {
  const application = yield* acquireSocketQueries(url, 'account-42').pipe(
    Effect.provide(Socket.layerWebSocketConstructorGlobal),
  )
  const { queryClient, rpc } = application
  try {
    const reads = yield* Effect.promise(() =>
      Promise.all([
        queryClient.query(rpc.values.read.queryOptions({ input: { id: 1 } })),
        queryClient.query(rpc.values.read.queryOptions({ input: { id: 2 } })),
      ]),
    )
    const input = { channel: 'clock' }
    const history = yield* Effect.promise(() =>
      fetchStreamSnapshot(queryClient, rpc.values.watch.streamedOptions({ input, maxChunks: 20 }), {
        timeoutMs: 5_000,
      }),
    )
    const latest = yield* Effect.promise(() =>
      fetchStreamSnapshot(queryClient, rpc.values.watch.liveOptions({ input }), {
        timeoutMs: 5_000,
      }),
    )
    return { reads, history, latest }
  } finally {
    yield* application.dispose
  }
})
```

For a long-lived UI, give the generated `streamedOptions` or `liveOptions` to a native
observer instead. Its first emission becomes successful query data while `fetchStatus`
remains `fetching`. Accumulated streams preserve history; live queries retain the latest
value. `maxChunks` controls cached history, and `rpcOptions.streamBufferSize` controls
the ready client's transport queue. They govern different resources.

## Cancel and replace an owner

Cancel one stream with its generated exact key, for example
`cancelQueries({ queryKey: options.queryKey, exact: true })`. Other stream keys and
concurrent unary calls continue on the same connection. TanStack retains its native
cancellation result: after a stream has published data, cancellation can settle its
query promise successfully with cached data.

Call `application.dispose` before disposing the server or an enclosing runtime. The
registered finalizer cancels queries and clears their cache before the client and socket
close. For a replacement owner, await disposal, acquire a new application Scope and
ready client, and construct a new QueryClient. The same semantic prefix can produce
the same keys while resource lifetimes and cache instances remain independent. Follow
[owner-switching rules](/effect-api-query/guides/switch-cache-owners/) when authentication changes.

Replacement acquires a new connection. Transport reconnection, backoff, credentials,
event replay, and whether failed queries retry belong to the application and Effect's
transport configuration. Reconnection does not imply that a cancelled stream resumes
from its last cached event.

## Interpret cancellation and failures

The WebSocket transport forwards an interrupted request to the RPC server. Cooperative
handler finalizers were observed on this transport for both stream views. A local abort
signal or idle query state alone cannot prove remote completion; use a domain
acknowledgement when an application must wait for server work to stop. Closing a
connection immediately after cancellation can race delivery of that interrupt.

An independent server interruption remains an `EffectRpcQueryError`, even when TanStack
has not cancelled the query. Its Cause preserves the failure received by the ready client;
wire serialization can change the original server's Cause representation. A failed stream
leaves already published data available alongside its error.

With Effect 4.0.0, cancelling a paused stream with a full transport buffer of size 1 can
stall other calls on the connection. This recipe uses the native default of 16. Verify
smaller buffers against the pinned transport version before changing that setting.

The default buffer is not a guarantee for larger chunks or unfinished queue offers.

Keep streaming success schemas compatible on both ends. With Effect 4.0.0, a chunk that fails
client Schema decoding can also fail unrelated calls sharing the connection. A larger buffer
does not isolate decoding failures.

Query cancellation stops future work cooperatively. It does not undo completed writes;
use an [explicit cancellable command](/effect-api-query/guides/cancellation/) when the domain requires one.
