# Use public decoded-message clients for server-local RPC

Status: Accepted. Extends [ADR 0007](0007-keep-the-core-factory-lifecycle-neutral.md)
and [ADR 0019](0019-host-effect-rpc-inside-tanstack-start.md).

Effect 4.0.0 exposes `RpcServer.makeNoSerialization` and
`RpcClient.makeNoSerialization` as public constructors for decoded message
channels. An application may connect their write callbacks within its own
Scope, supply the server handler and middleware Context, and pass the resulting
flat ready client to `createRpcQueryUtils`. Server-local execution therefore
needs no loopback request or library-owned client factory. The browser keeps
its independently scoped HTTP or socket client.

Use a separate connection and QueryClient for each request identity. The
server-owned handler Context determines services and authority; validate
request headers in middleware. Capture the application's server Context during
construction and provide it to every `server.write` call. Native dispatch merges
the handler Context with its current fiber Context; dispatching directly from a
caller runner permits that runner's services to override handler-owned services.
The proof supplies conflicting runner identities to both concurrent clients and
preserves their server-owned identities. Caller Context and explicit native call
Context stay outside the authority-owning dispatch boundary. Keep stream
acknowledgements enabled, and set the server's
`disableFatalDefects: true` to preserve complete failed Exits rather than
collapsing fatal defect Causes. Cancel queries before closing the caller-owned
Scope.

This route constructs payloads and carries decoded values, middleware headers,
Exits, acknowledgements, and interrupts. It deliberately performs no transport
Schema encoding or decoding. Native call types retain residual Schema service
requirements, so the adapter still requires the application's matching runner;
this does not prove that codec effects execute on a decoded channel. Applications
that require wire validation or codec side effects should keep the schema-aware
`RpcClient.make` protocol. An application-owned `FetchHttpClient.Fetch` can
dispatch that protocol to its existing Web handler without a network request;
that separate recipe must verify its own transport and resource semantics.

The bounded executable proof is
[`tests/create-rpc-query-utils-server-local.test.ts`](../../tests/create-rpc-query-utils-server-local.test.ts),
with its application recipe in
[`tests/fixtures/server-local-rpc.ts`](../../tests/fixtures/server-local-rpc.ts)
and native service/type evidence in
[`tests/types/server-local-client-contract.ts`](../../tests/types/server-local-client-contract.ts).
It uses the public constructors directly, with the network fetch boundary
disabled. It verifies decoded class behavior, payload defaults, authenticated
request isolation, complete Causes, cancellation, finalization, and independent
Scope disposal. `RpcTest` and `HttpApiTest` remain test support rather than
production construction guarantees. The unstable upstream constructors remain
qualified by the package's exact Effect peer.

`vp run test` includes the native constructor contract through
`vp run server-local-types`, using the repository compiler and TypeScript 5.9.
Published adapter contracts remain covered by the existing packed consumers.
