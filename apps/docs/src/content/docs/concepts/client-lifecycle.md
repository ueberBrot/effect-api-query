---
title: Client Lifecycle
description: Keep RPC and HTTP clients, runtimes, and resources under caller ownership.
---

`createRpcQueryUtils` accepts a ready flat RPC client. Your application acquires the client, keeps
its `Scope` open, and disposes its resources:

1. Open the RPC client's `Scope` and build any required runtime.
2. Create a `QueryClient` and RPC utility tree.
3. Generated ordinary, infinite, accumulated-stream, live, and mutation functions call the ready
   client through `runPromiseExit`.
4. At shutdown, cancel active queries, clear the cache, and then close the RPC client resources.

On the server, create these resources separately for each request to keep request data and scoped
services isolated. In the browser, keep them for the application lifetime.

The factory has no React, router, transport, provider, or server-rendering lifecycle of its own.

## HTTP clients and execution services

`createHttpApiQueryUtils` accepts a ready HttpApiClient. The application builds its HTTP transport,
installs client middleware, and owns any runtime or Scope used by that client. Use request-scoped
clients and QueryClients on the server, and dispose their resources when the request ends.

Calls that need no services default to `Effect.runPromiseExit`. If an exposed endpoint needs request
encoding, success decoding, or error decoding services, supply a `runPromiseExit` that provides
them. The runner must also provide any services the ready client still requires. It must forward its
`options` argument so query cancellation reaches Effect. Omitted endpoints add no requirements.
A custom key encoder supplies cache identity only; execution still needs those services.

Configure HTTP authentication and request middleware when constructing the ready client. HTTP
builders have no `rpcOptions`. Include safe user or tenant identifiers in `keyPrefix` whenever middleware
changes the result for that identity. See the [HTTP factory](/effect-api-query/reference/http-factory/)
for decoded request input and the independent key-encoder contract.

## Request-local RPC configuration

Use a builder's `rpcOptions` for metadata or configuration specific to one request, such as a
request-source header or streaming buffer size. The `context` value is local to Effect RPC client
processing; it is not a serialized server Context and does not replace the supplied Effect runner.

Keep ordinary authentication, middleware, transport setup, runtime services, and Scope ownership
in the application-owned client and runtime.
