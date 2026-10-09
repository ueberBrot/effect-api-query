---
title: Client Lifecycle
description: Keep RPC and HTTP clients, runtimes, and resources under caller ownership.
---

`createRpcQueryUtils` accepts a ready flat RPC client. Your application acquires the client, keeps
its `Scope` open, and disposes its resources:

1. Open the RPC client's `Scope` and build any required runtime.
2. Create a `QueryClient` and RPC utility tree.
3. Run ordinary, infinite, accumulated-stream, and live queries or mutations. Their generated
   functions call the ready client through `runPromiseExit`.
4. At shutdown, cancel active queries, clear the cache, and then dispose the RPC client's resources.

On the server, create these resources separately for each request to keep request data and scoped
services isolated. In the browser, keep them for the application lifetime.

The factory has no React, router, transport, provider, or server-rendering lifecycle of its own.

## HTTP clients and execution services

`createHttpApiQueryUtils` accepts a ready HttpApiClient. The application builds its HTTP transport,
installs client middleware, and manages any runtime or `Scope` the client uses. On the server,
create a client and `QueryClient` for each request and dispose their resources when it ends.

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

Manage authentication, middleware, transport setup, runtime services, and `Scope` in your
application client and runtime.

## Stream creation and consumption

For an accumulated streamed RPC or live RPC query, the runner executes
`Stream.toAsyncIterableEffect` to create an iterable and capture its Effect `Context`. The runner
returns a successful `Exit` before Query Core pulls values. Iterator pulls then use that captured
Context while the query remains fetching. Keep its services and the ready client's Scope alive
until consumption finishes.

Apply transformations to the stream returned by the ready client, before it reaches the utility
tree. Use `Stream.map` for value changes, `Stream.mapEffect` for service-dependent work,
`Stream.tap` for per-emission instrumentation, and `Stream.ensuring` for completion or cancellation
cleanup. For RPC, wrap the streaming call at the ready-client boundary; preserve its payload,
request options, and declared success/error types. For HTTP, retain the native client's response
mode contract when applying a stream transformation.

A timer, span, finalizer, or retry schedule around the runner's creation Effect ends with iterable
creation. It does not wrap the later pulls. Put stream-lifetime instrumentation and recovery on the
stream itself. A retry in generated Query options reruns the query function and creates another
iterable. Coordinate it with stream and transport schedules as described in
[retry queries](/effect-api-query/guides/retry-queries/#set-defaults-deliberately).

At shutdown, cancel active queries, await application-owned stream finalization, clear the cache,
and then dispose the runtime or close the client Scope. `cancelQueries` restores Query's cache
state; iterator cleanup can finish asynchronously, so wait for your resource's completion signal
before disposal. Settle pending mutations separately because they have no query abort signal.

The [packed runner fixture](https://github.com/ueberBrot/effect-api-query/blob/main/tests/packed-consumer/retry-runtime.mts)
checks both stream views: creation finishes before the first transformed emission, pulls and
finalizers retain the runner's provided Context, and cancellation finalizes the stream before
client disposal.
