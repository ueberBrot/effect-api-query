---
title: Client Lifecycle
description: Keep RPC and HTTP clients, runtimes, and resources under caller ownership.
---

Both factories use ready clients. The application owns transport, middleware, runtime,
Scope, and QueryClient:

1. Acquire the RPC or HTTP client and the services it requires.
2. Create a QueryClient and utility tree for that owner.
3. Keep those resources alive while queries, streams, and mutations run.
4. Stop consumers, cancel queries, await local stream cleanup and accepted mutations,
   clear the cache, then release the client and runtime.

Server requests own independent resources. Browser applications keep them for their lifetime.

## HTTP clients and execution services

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

For an accumulated or live RPC or HTTP SSE query, the runner executes
`Stream.toAsyncIterableEffect` to create an iterable and capture its Effect `Context`. The runner
returns a successful `Exit` before Query Core pulls values. Iterator pulls then use that captured
Context while the query remains fetching. Keep its services and the ready client's Scope alive
until consumption finishes.

Transform or instrument the ready-client stream when the work must cover consumption.
Preserve its request options, declared value/error types, and HTTP response-mode contract.
Use a stream finalizer for completion or cancellation cleanup.

A timer, span, finalizer, or retry schedule around the runner's creation Effect ends with iterable
creation. It does not wrap the later pulls. Put stream-lifetime instrumentation and recovery on the
stream itself. A retry in generated Query options reruns the query function and creates another
iterable. Coordinate it with stream and transport schedules as described in
[retry queries](/effect-api-query/guides/retry-queries/#set-defaults-deliberately).

Native `cancelQueries` settlement can precede asynchronous iterator cleanup. Await the
resource's completion signal before releasing its services. Mutations settle separately because
they have no query abort signal.

For an open-stream server capture, await
[fetchStreamSnapshot](/effect-api-query/guides/stream-snapshots/) before dehydration or client
disposal. The helper waits for local iterator cleanup; remote completion still requires an
application acknowledgement.
