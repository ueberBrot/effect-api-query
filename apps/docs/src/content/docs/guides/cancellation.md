---
title: Cancellation
description: Cancel queries and request server-side cancellation for long-running commands.
---

Forward TanStack's `AbortSignal` in your application runner. Import `RunPromiseExit` from `@ueberbrot/effect-api-query`.

```ts
const runPromiseExit: RunPromiseExit = (effect, options) =>
  runtime.runPromiseExit(effect, options);
```

To cancel one RPC request from a loader or event handler, pass its exact generated key.

```ts
const input = { durationMs: 60_000, operationId: "slow-query" };

void queryClient.query(rpcQuery.diagnostics.slow.queryOptions({ input }));

await queryClient.cancelQueries({
  queryKey: rpcQuery.diagnostics.slow.queryKey(input),
});
```

TanStack aborts the signal, and the runner uses it to interrupt Effect. Remote interruption depends on your RPC transport.

Infinite pages and both stream views use the same signal. On cancellation, the adapter calls the stream iterator's `return()` to run finalizers. TanStack can also cancel a stream when its last ordinary observer leaves or a refetch replaces it.

Use ordinary hooks if cancellation matters, especially for open streams. TanStack documents a cancellation limit for `useSuspenseQuery`, `useSuspenseQueries`, and `useSuspenseInfiniteQuery`. See [TanStack's limitations](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation#limitations) and [Suspense and recovery](/effect-api-query/guides/suspense-and-recovery/).

## Cancel an HTTP query

Pass an HTTP `queryKey(input)` or `key()` prefix to `queryClient.cancelQueries`. The generated function forwards the signal to the runner. The default runner interrupts the HTTP client. A fetch transport aborts its pending request. A custom runner must forward the signal to do the same. TanStack controls cancellation state and cache behavior.

## Request server cancellation explicitly

Mutations have no query abort signal. To stop long-running server work, assign an operation ID before starting it. Provide a server operation that requests cancellation. Use a separate read to observe the command's terminal state.

A closed connection only shows that the client disconnected. The server cancellation request stops future work when the worker observes it. Wait for an application acknowledgement if you need server cleanup. To reverse completed work, issue a separate compensation operation.

The [cancellable commands example](/effect-api-query/examples/cancellable-commands/) runs start, status, and cancel operations. It also demonstrates retries with the same ID, concurrent commands, and in-memory worker limits.

## Release resources after local cleanup

Cancel the query before releasing its services. `cancelQueries` can settle before asynchronous finalizers finish. Keep the client, Scope, and runner alive until local cleanup finishes. Wait for accepted mutations separately.

A replacement stream can start while the previous iterator cleans up. If they share an exclusive resource, use one application lock for every acquisition path, including automatic refetch. Hold it until cleanup finishes. During owner shutdown, wait for the old stream's cleanup before acquiring its replacement.

Cancelling a query with `publicationBatchSize` discards unpublished events. Native cancellation decides whether to retain or revert published data. To stop a [recovered stream](/effect-api-query/guides/reconnect-streams/), interrupt its consuming Effect. This stops active consumption, retry backoff, or a replay refresh. Wait for local finalizers before disposal.

See [client lifecycle](/effect-api-query/concepts/client-lifecycle/) for disposal. To capture a finite result and wait for iterator cleanup, use a [stream snapshot](/effect-api-query/guides/stream-snapshots/).
