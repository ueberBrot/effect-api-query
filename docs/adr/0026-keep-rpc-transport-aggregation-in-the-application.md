# Keep RPC transport aggregation in the application

Status: Accepted. Extends [ADR 0007](0007-keep-the-core-factory-lifecycle-neutral.md).

## Context

Independent ready RPC client calls can incur repeated HTTP headers and connection overhead. A
shared WebSocket can reduce that cost while preserving individual request envelopes, responses,
failures, and cancellation.

## Decision

The application selects and owns the transport. Keep independent Query execution in the RPC
utility tree. Use a shared WebSocket when repeated HTTP overhead matters, or declare an explicit
bulk RPC when the domain supports one. A collecting custom protocol must own its collection delay,
response routing, retries, failures, interruption, and lifetime.

Transport aggregation, backend RequestResolver batching, and Query publication address separate
costs. A shared server RequestResolver can combine backend lookups while frontend RPC requests
remain independent. Query notification batching changes callback scheduling; streamed publication
batching changes cache update frequency. Neither reduces transport request count.

Effect 4.0.0's stock HTTP protocol performs one POST per Request in
`node_modules/effect/src/rpc/RpcClient.ts`, `makeProtocolHttp`. Its `makeProtocolSocket` shares a
writer and routes responses by request ID, then writes each encoded message separately. The
WebSocket adapter's writer maps each write to one send in `node_modules/effect/src/socket/Socket.ts`.
JSON array/framing support in `RpcSerialization.ts` and batch input parsing in `RpcServer.ts`
provide no stock-client collection window.

## Measurement

The [protocol fixture](../../examples/server/tests/rpc-transport-overhead.test.ts) uses real loopback
Effect HTTP/WebSocket servers, ready clients, the public package factory, and a real QueryClient.
Each row starts a fresh host, client, and cache, then runs concurrent unary queries with distinct
integer payloads. JSON serialization, fixed request IDs, disabled RPC tracing, and disabled Query
retries keep the request sizes comparable.

```sh
RPC_TRANSPORT_MEASURE=1 vp run --no-cache test examples/server/tests/rpc-transport-overhead.test.ts
```

The October 9, 2026 measurement used Node 24.5.0, Effect and Node platform 4.0.0, Query Core 5.104.0,
and Vite+ 1.0.0.

| Calls | Transport | POSTs / sends | Connections | Envelope bytes | Header / upgrade bytes | Client → server bytes |
| ----: | --------- | ------------: | ----------: | -------------: | ---------------------: | --------------------: |
|     1 | HTTP      |             1 |           1 |             77 |                    371 |                   448 |
|     1 | WebSocket |             1 |           1 |             77 |                    227 |                   310 |
|     8 | HTTP      |             8 |           8 |            616 |                  2,968 |                 3,584 |
|     8 | WebSocket |             8 |           1 |            616 |                    227 |                   891 |
|    32 | HTTP      |            32 |          32 |          2,508 |                 11,872 |                14,380 |
|    32 | WebSocket |            32 |           1 |          2,508 |                    227 |                 2,927 |

At eight calls, WebSocket multiplexing reduces outbound bytes by about 75% while retaining eight
envelopes and eight sends. At 32 calls the reduction is about 80%. Each query returns its individual
value and creates a separate successful cache entry.

Counts use encoded HTTP bodies, actual request lines/raw headers, WebSocket sends, and server TCP
`bytesRead`. WebSocket totals include one upgrade and six masked-frame bytes per small request.
Counts end after responses arrive and before disposal. Responses, TCP/IP headers, TLS, connection
setup packets, and later keepalives are excluded. This measures bytes and requests, not latency,
throughput, or CPU cost. HTTP connection counts reflect this cold concurrent HTTP/1.1 fetch pool;
warm connections, HTTP/2, browsers, compression, larger payloads, and remote backends need their own
measurement. Header sizes depend on the Node/fetch version and application headers.

## Consequences

Acquire the socket, build its protocol Layer into an application-owned client Scope with
`Layer.buildWithScope`, and acquire the flat client with that Context and Scope. Keep the Scope
alive while the utility tree uses the ready RPC client. Close the client Scope before its host;
providing the socket protocol Layer only around acquisition closes its receive loop too early.

For backend batching, share one `RequestResolver.make` instance in the server service, optionally
set a collection delay with `RequestResolver.setDelay`, run the backend bulk operation, and complete
each entry with its individual Exit. Handlers call `Effect.request(request, resolver)`. The installed
recipe is `node_modules/effect/ai-docs/src/05_batching/10_request-resolver.ts`; collection belongs to
the shared resolver instance and batch key. A collection delay adds latency.

The package retains its lifecycle-neutral ready-client boundary and adds no automatic transport
batching API.
