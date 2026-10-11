---
title: WebSocket ready clients
description: Acquire a shared RPC connection and keep cancellation and replacement application-owned.
---

Acquire a flat Effect RPC client inside an application Scope, then pass it to
`createRpcQueryUtils`. The same connection can carry concurrent unary requests,
accumulated streamed queries, and live queries. Each request retains its own query key
and cancellation.

## Acquire the connection

Keep the flat ready client and its parent Scope alive. The
[complete acquisition recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/fixtures/socket-client.ts)
owns the socket, protocol, client and QueryClient cleanup. In that application setup:

```ts
const rpc = createRpcQueryUtils(socketGroup, { client, keyPrefix: ['socket', owner] })
```

The host supplies `Socket.layerWebSocketConstructorGlobal` in browsers or
`NodeSocket.layerWebSocketConstructorWS` in Node. The server uses the same group and
serialization through `RpcServer.toHttpEffectWebsocket`; this recipe uses JSON.

## Read and capture stream data

Use generated `queryOptions` for unary reads and native observers for `streamedOptions` or
`liveOptions`. Independent keys share the connection without sharing cancellation.
The first stream emission becomes successful data while `fetchStatus` remains `fetching`.

In a server/request loader, await `fetchStreamSnapshot(queryClient, options, controls)`
with the generated history or live options. For this recipe, `input` is
`{ channel: 'clock' }`; history uses
`rpc.values.watch.streamedOptions({ input, maxChunks: 20 })`, while latest data uses
`rpc.values.watch.liveOptions({ input })`. Each capture has `timeoutMs: 5000` and settles
local cleanup before disposal.

The [complete typed snapshot recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/fixtures/docs-websocket-use.ts)
includes concurrent reads and disposal. [Stream Snapshots](/effect-api-query/guides/stream-snapshots/)
explains exclusive capture and local finalizer drain. `maxChunks` bounds cached history;
`rpcOptions.streamBufferSize` bounds the transport queue. They govern different resources.

## Cancel and replace an owner

Cancel one stream with its generated exact key, for example
`cancelQueries({ queryKey: options.queryKey, exact: true })`. Other stream keys and
concurrent unary calls continue on the same connection. TanStack retains its native
cancellation result: after a stream has published data, cancellation can settle its
query promise successfully with cached data.

Drain local work and call `application.dispose` before disposing the server or an enclosing runtime. The
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
