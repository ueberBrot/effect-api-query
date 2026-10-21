---
title: Client Lifecycle
description: Keep RPC and HTTP clients, runtimes, and resources under caller ownership.
---

Both factories use ready clients. Your application owns the transport, middleware, runtime, Scope, and QueryClient. Their lifetime follows this sequence:

1. Acquire the RPC or HTTP client and the services it requires.
2. Create a QueryClient and utility tree for that owner.
3. Keep those resources alive while queries, streams, and mutations run.
4. Stop consumers and cancel queries. Await local stream cleanup and accepted mutations. Clear the cache, then release the client and runtime.

Each server request owns independent resources. A browser application keeps its resources alive for its lifetime.

## HTTP clients and execution services

Calls that need no services default to `Effect.runPromiseExit`. An exposed endpoint can require services to encode requests or decode successes and errors. In that case, supply a `runPromiseExit` that provides those services and any services the ready client still requires. Forward the runner's `options` argument so query cancellation reaches Effect. Omitted endpoints add no requirements. A custom key encoder supplies cache identity. Execution still needs its own services.

Configure HTTP authentication and request middleware when you construct the ready client. HTTP builders have no `rpcOptions`. If middleware changes results for a user or tenant, include safe identifiers in `keyPrefix`. The [HTTP factory](/effect-api-query/reference/http-factory/) describes decoded request input and the separate contract for key encoders.

## Request-local RPC configuration

Use a builder's `rpcOptions` for metadata or configuration specific to one request, such as a request-source header or stream buffer size. The `context` value applies to local Effect RPC client processing. It is not a serialized server Context and does not replace the supplied Effect runner.

Your application client and runtime manage authentication, middleware, transport setup, runtime services, and `Scope`.

## Stream creation and consumption

For accumulated and live queries over RPC or HTTP SSE, the runner executes `Stream.toAsyncIterableEffect`. That Effect creates an iterable and captures its Effect `Context`. The runner returns a successful `Exit` before Query Core pulls values. Those pulls use the captured Context while the query remains fetching. Keep the Context's services and the ready client's Scope alive until consumption finishes.

If work must cover consumption, transform or instrument the ready-client stream. Preserve its request options, declared value and error types, and HTTP response-mode contract. A stream finalizer handles cleanup after completion or cancellation.

A timer, span, finalizer, or retry schedule around the runner's creation Effect ends when it creates the iterable. It does not cover later pulls. Put instrumentation and recovery for the stream's lifetime on the stream itself. A retry in generated Query options reruns the query function and creates another iterable. Coordinate query retries with stream and transport schedules as described in [retry queries](/effect-api-query/guides/retry-queries/#set-defaults-deliberately).

Native `cancelQueries` can settle before asynchronous iterator cleanup finishes. Await the resource's completion signal before you release its services. Mutations settle separately because they have no query abort signal.

To capture an open stream on the server, await [fetchStreamSnapshot](/effect-api-query/guides/stream-snapshots/) before dehydration or client disposal. The helper waits for local iterator cleanup. Remote completion still requires an application acknowledgement.
