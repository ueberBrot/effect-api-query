---
title: Client Lifecycle
description: Keep RPC and HTTP clients, runtimes, and resources under caller ownership.
---

Your application acquires the Effect client and releases it when work is done. Use this order.

1. Acquire the RPC or HTTP client and the services it needs.
2. Create the QueryClient and utility tree for that owner.
3. Keep these resources alive while queries, streams, or mutations use them.
4. Stop consumers and cancel queries. Wait for local stream cleanup and accepted mutations. Clear the cache, then release the client and runtime.

Give each server request its own resources. Keep browser resources alive for the lifetime of the app or cache owner. A browser window and a dedicated worker each own their own client, runner, Scope, and QueryClient. Wait for local cleanup before you terminate a worker.

## HTTP clients and execution services

Service-free Effects use the default runner. If the client, request encoder, or response decoder needs services, pass a ManagedRuntime as `runtime`. Its layer must have a `never` error type. If you pass a runner function, forward its options so query cancellation reaches Effect. A custom key encoder only builds cache identity. Supply execution services separately.

Set authentication and request middleware on the HTTP client before passing it to the factory. If middleware changes results by user or tenant, include a safe identifier in `keyPrefix`. See the [HTTP factory](/effect-api-query/reference/http-factory/) for request input and key encoders.

## Request-local RPC configuration

Pass `rpcOptions` for one RPC request, for example to set a header or the stream buffer size. Its `context` stays on the client. The supplied runner still provides execution services.

## Stream creation and consumption

The runner calls `Stream.toAsyncIterableEffect` for accumulated and live queries. It returns the iterable before Query Core starts pulling values. Those pulls use the Effect `Context` captured at creation. Keep its services and the client's Scope alive until consumption ends.

To trace or retry consumption, wrap the ready client's stream. Preserve its request options, value and error types, and HTTP response mode. Use a stream finalizer for cleanup.

A timer, span, finalizer, or retry around iterable creation only covers setup. A retry in Query options reruns the query function and creates another iterable. See [retry queries](/effect-api-query/guides/retry-queries/#set-defaults-deliberately) to choose where retries belong.

`cancelQueries` can settle while the iterator is still cleaning up. Wait for the resource's completion signal before you release it. Wait for mutations separately because they have no query abort signal.

For server rendering, await [fetchStreamSnapshot](/effect-api-query/guides/stream-snapshots/) before you dehydrate the cache or dispose of the client. The helper waits for local iterator cleanup. Use an application acknowledgement if you need proof of remote completion.

To register resources and wait for local work during retirement, use the optional [query owner helper](/effect-api-query/guides/switch-cache-owners/#opt-in-owner-helper). See the [React setup](/effect-api-query/guides/react-query/) for acquisition, mounting, and disposal.
