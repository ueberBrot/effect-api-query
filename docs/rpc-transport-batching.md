# RPC transport batching decision

Keep transport policy in Effect and the application. The installed Effect 4.0.0 HTTP and socket
protocols send one request envelope per independent call. A shared WebSocket removes repeated HTTP
request headers and shares one connection, but it still sends each envelope separately. This
measurement supports an application-owned multiplexed transport when request overhead matters;
it does not justify an automatic batching engine in the RPC utility tree.

## Reproduce the measurement

Run the retained [protocol fixture](../examples/server/tests/rpc-transport-overhead.test.ts):

```sh
RPC_TRANSPORT_MEASURE=1 vp run --no-cache test examples/server/tests/rpc-transport-overhead.test.ts
```

The fixture uses the public package factory, a real QueryClient, public Effect clients/servers,
and the existing server workspace's Node platform adapter. It runs 1, 8, and 32 concurrent unary
queries with distinct integer payloads and empty caches. Each call returns its own integer; Query
retries are disabled. Fixed request IDs and disabled RPC tracing make envelope sizes reproducible.
No dependencies are installed.

The October 9, 2026 baseline used Node 24.5.0, Effect and Node platform 4.0.0, Query Core 5.104.0,
and Vite+ 1.0.0. Each row starts a fresh loopback host and ready client. HTTP uses FetchHttpClient
with JSON serialization; WebSocket uses the installed Node WebSocket constructor with the same
serialization. HTTP connection counts describe this concurrent HTTP/1.1 workload and the default
fetch connection pool, rather than a requirement of the RPC protocol.

| Calls | Transport | POSTs / WebSocket sends | Connections | RPC envelope bytes | HTTP request / upgrade bytes | Client → server bytes |
| ----: | --------- | ----------------------: | ----------: | -----------------: | ---------------------------: | --------------------: |
|     1 | HTTP      |                       1 |           1 |                 77 |                          371 |                   448 |
|     1 | WebSocket |                       1 |           1 |                 77 |                          227 |                   310 |
|     8 | HTTP      |                       8 |           8 |                616 |                        2,968 |                 3,584 |
|     8 | WebSocket |                       8 |           1 |                616 |                          227 |                   891 |
|    32 | HTTP      |                      32 |          32 |              2,508 |                       11,872 |                14,380 |
|    32 | WebSocket |                      32 |           1 |              2,508 |                          227 |                 2,927 |

For eight calls, multiplexing reduces measured client-to-server bytes by about 75%; at 32 calls,
the reduction is about 80%. Envelope counts and envelope bytes remain equal. All calls produce
separate successful cache entries.

Byte counts come from encoded HTTP bodies, the actual request line and raw headers, actual
WebSocket sends, and the server TCP sockets' `bytesRead`. WebSocket totals include one upgrade
request and the six-byte masked frame overhead of each small request in this fixture. Counts end
after responses arrive and before disposal. They exclude response traffic, TCP/IP packet headers,
TLS, connection setup packets, and later keepalives. They measure bytes and calls, not latency,
throughput, or CPU cost. Browser, HTTP/2, TLS, compression, warm connections, larger payloads, and
remote backends require their own application measurement. Exact header bytes may change with the
Node/fetch version or application headers.

## Configure the layer that owns the cost

| Concern                                                   | Owner and control                                                     | Effect on independent RPC requests                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection and repeated HTTP overhead                     | Application selects a shared socket protocol                          | One request envelope and WebSocket send per call; one shared connection                                                                            |
| Several logical operations in one HTTP request            | Application declares a bulk RPC or owns a collecting custom protocol  | A bulk RPC can change the contract to one request; a custom protocol must preserve per-call response routing, failures, interruption, and lifetime |
| Backend/database lookup overhead                          | Server shares a RequestResolver and uses the backend's bulk operation | Fewer backend calls can serve separate RPC requests; network requests remain independent                                                           |
| Query cache publication or observer notification overhead | Application/Query consumption and notification policy                 | Changes update frequency or callback scheduling; it does not change transport request count                                                        |

Effect's HTTP client protocol encodes a single request and performs a single POST in
`node_modules/effect/src/rpc/RpcClient.ts`, `makeProtocolHttp` (lines 937–949). The socket protocol
shares a writer and routes responses by request ID, then encodes and writes each message separately
in `makeProtocolSocket` (lines 1068–1072, 1103–1110, 1195–1204). The public WebSocket adapter maps
each write to one `send` in `node_modules/effect/src/socket/Socket.ts` (lines 1128–1137).

`node_modules/effect/src/rpc/RpcSerialization.ts` accepts JSON arrays and provides NDJSON/JSON-RPC
framing. The HTTP server also accepts multiple decoded messages in one request
(`RpcServer.ts`, lines 1160–1168). Those parsing capabilities do not collect independent calls in
the stock ready client. No stock-client aggregation option is supported by this exact version.

For backend batching, construct one shared `RequestResolver.make` in the server service, optionally
set its collection delay with `RequestResolver.setDelay`, invoke a backend bulk operation for the
collected IDs, and complete every entry with its individual Exit. Handlers use
`Effect.request(request, resolver)`. Sharing the resolver is essential: its instance and batch key
own collection, and a delay adds latency before backend execution. The installed primary-source
recipe is `node_modules/effect/ai-docs/src/05_batching/10_request-resolver.ts` (lines 39–73); resolver
collection lives in `node_modules/effect/src/internal/request.ts` (lines 82–98, 116–165).

Query Core's `node_modules/@tanstack/query-core/src/notifyManager.ts` batches notification
callbacks (lines 32–73, 100–113). This does not aggregate requests or replace individual cache
writes. A policy that batches streamed Query data publication addresses another cost and must
define its own delivery and cancellation behavior.

## Keep the ready client alive

The fixture demonstrates the supported socket ownership recipe: acquire the Socket, build
`RpcClient.layerProtocolSocket()` with serialization into the application's client Scope using
`Layer.buildWithScope`, and acquire `RpcClient.make(..., { flatten: true })` with that Context and
Scope. Pass the resulting ready RPC client to `createRpcQueryUtils`. Finish/cancel its queries and
close the client Scope before closing the host. The package acquires or disposes none of these
resources, as required by [ADR 0007](adr/0007-keep-the-core-factory-lifecycle-neutral.md).

Providing a socket protocol Layer only around the acquisition Effect closes its receive-loop
resources when that Effect returns. Keep the Layer's Scope alive for all later calls. The fixture
closes its explicitly owned client Scope and loopback listener on every run.

The bounded decision is to retain ordinary independent Query execution. Applications can choose
the proven shared WebSocket transport when repeated HTTP overhead matters, declare an explicit
bulk operation when their domain supports one, or batch backend work with RequestResolver. A
generic HTTP collection window has no stock-client support here and would introduce latency,
failure, cancellation, and retry policy that belongs to the application.
