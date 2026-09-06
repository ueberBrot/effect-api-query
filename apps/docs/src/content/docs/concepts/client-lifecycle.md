---
title: Client Lifecycle
description: Keep RPC and HTTP clients, runtimes, and resources under caller ownership.
---

The factory accepts a ready flat RPC client. It does not acquire the client, open its `Scope`, or
dispose application resources.

This boundary keeps ownership explicit:

1. The application opens the RPC client’s `Scope` and builds any required runtime.
2. The application creates its `QueryClient` and RPC utility tree.
3. Generated ordinary, infinite, accumulated-stream, live, and mutation functions call the ready
   client through `runPromiseExit`.
4. Shutdown cancels active queries, clears the cache, and then closes the RPC client resources.

Use a separate application boundary per server request. In a browser, retain one boundary for the
application lifetime. This prevents request data and scoped services from leaking between owners.

The factory has no React, router, transport, provider, or server-rendering lifecycle of its own.

## HTTP clients and execution services

`createHttpApiQueryUtils` accepts a ready HttpApiClient. The application builds its HTTP transport,
installs client middleware, and owns any runtime or Scope used by that client. Use request-scoped
clients and QueryClients on the server, and dispose their resources when the request ends.

Service-free execution defaults to `Effect.runPromiseExit`. If an exposed endpoint needs request
encoding, success decoding, or error decoding services, supply a `runPromiseExit` that provides
them. The runner must also provide residual services retained by the ready client and forward its
`options` argument so query cancellation reaches Effect. Omitted endpoints add no requirements.
A custom key encoder supplies cache identity only; execution still needs those services.

Configure HTTP authentication and request middleware when constructing the ready client. HTTP
builders have no `rpcOptions`. Partition `keyPrefix` with safe identity values whenever middleware
changes the result for a user or tenant. See the [HTTP factory](/effect-rpc-query/reference/http-factory/)
for decoded request input and the independent key-encoder contract.

## Request-local configuration

Use a builder's `rpcOptions` for metadata or configuration specific to one request, such as a
request-source header or streaming buffer size. The `context` value is local to Effect RPC client
processing; it is not a serialized server Context and does not replace the supplied Effect runner.

Keep ordinary authentication, middleware, transport setup, runtime services, and Scope ownership
in the application-owned client and runtime.
