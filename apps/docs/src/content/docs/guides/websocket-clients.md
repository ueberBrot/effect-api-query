---
title: WebSocket ready clients
description: Acquire a shared RPC connection and keep cancellation and replacement application-owned.
---

Acquire a flat RPC client in an application Scope and pass it to `createRpcQueryUtils`. One WebSocket can carry concurrent unary and streaming requests. Each request has its own key and can be cancelled independently.

## Acquire the connection

Follow the [acquisition example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/fixtures/socket-client.ts) to set up the socket, protocol, client, and QueryClient. Keep the parent Scope alive through cleanup.

```ts
const rpc = createRpcQueryUtils(socketGroup, {
  client,
  keyPrefix: ["socket", owner],
});
```

Use `Socket.layerWebSocketConstructorGlobal` in browsers or `NodeSocket.layerWebSocketConstructorWS` in Node. The server uses `RpcServer.toHttpEffectWebsocket` with the same RPC group and serialization. This example uses JSON.

## Read and capture stream data

Use `queryOptions` for unary reads and ordinary observers for `streamedOptions` or `liveOptions`. The first value succeeds while `fetchStatus` remains `fetching`.

In a server loader, await `fetchStreamSnapshot(queryClient, options, controls)` before disposal. For `input = { channel: 'clock' }`, use `rpc.values.watch.streamedOptions({ input, maxChunks: 20 })` for history. Use `rpc.values.watch.liveOptions({ input })` for the latest value. The example sets `timeoutMs: 5000`.

The [snapshot example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/fixtures/docs-websocket-use.ts) shows concurrent reads and disposal. See [stream snapshots](/effect-api-query/guides/stream-snapshots/) for exclusive capture. Set `maxChunks` for cached history and `rpcOptions.streamBufferSize` for the transport queue.

## Cancel and replace an owner

Cancel one stream with `cancelQueries({ queryKey: options.queryKey, exact: true })`. Other requests keep using the connection. If the stream already published data, TanStack can settle the canceled query promise successfully with cached data.

Call `application.dispose` before disposing of the server or enclosing runtime. The finalizer cancels queries and clears the cache before closing the client and socket. Wait for disposal before creating the replacement Scope, client, and QueryClient.

Equivalent prefixes and inputs can produce the same keys across independent caches. See [cache owners](/effect-api-query/guides/switch-cache-owners/) when authentication changes.

A replacement uses a new connection. Configure backoff, credentials, replay, and retry in your app and transport. To resume from the last accepted event, pass a cursor supported by the server.

## Interpret cancellation and failures

The transport forwards an interruption to the server. Tests observe cooperative handler finalizers for both views. Closing the socket immediately can race delivery of the interrupt. Use a domain acknowledgement if you need to know when server cleanup finishes.

An independent server interruption becomes `EffectRpcQueryError`. Its Cause is the value the ready client received. Serialization can change the original server representation. A failed stream leaves already published data alongside its error.

Use compatible stream success Schemas on both ends. A chunk that fails decoding ends that request.

To stop domain work, use an [explicit cancellation operation](/effect-api-query/guides/cancellation/). Use compensation to reverse a completed write.
