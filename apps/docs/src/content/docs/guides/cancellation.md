---
title: Cancellation
description: Cancel queries and request server-side cancellation for long-running commands.
---

In your application client module, forward TanStack's `AbortSignal` to the runtime. Import `RunPromiseExit` from `@ueberbrot/effect-api-query`:

```ts
const runPromiseExit: RunPromiseExit = (effect, options) =>
  runtime.runPromiseExit(effect, options);
```

In a loader or event handler, use the ready RPC utility tree to cancel a request with its generated key:

```ts
const input = { durationMs: 60_000, operationId: "slow-query" };

void queryClient.query(rpcQuery.diagnostics.slow.queryOptions({ input }));

await queryClient.cancelQueries({
  queryKey: rpcQuery.diagnostics.slow.queryKey(input),
});
```

TanStack aborts the signal. The runner must translate the abort into Effect interruption. To stop the server operation, the RPC transport must also support interruption. `effect-api-query` does not add a transport-specific cancellation protocol.

Infinite page requests, accumulated streams, and live queries use the same signal. Cancelling a stream query also calls `return()` on its AsyncIterator. That call runs the Effect stream's finalizers. TanStack also cancels an active stream when its last observer unmounts or a refetch supersedes it.

These guarantees apply to ordinary query observers. TanStack documents that cancellation does not work with `useSuspenseQuery`, `useSuspenseQueries`, and `useSuspenseInfiniteQuery`. Generated options and signal forwarding preserve that limitation. Choose ordinary hooks when your screen depends on cancellation, particularly for open streams. See [TanStack's limitations](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation#limitations) and [Suspense and Error Recovery](/effect-api-query/guides/suspense-and-recovery/).

Mutations do not receive TanStack query signals, so generated mutation functions cannot cancel a mutation automatically.

## Cancel an HTTP query

Use `queryClient.cancelQueries` with the HTTP endpoint's generated `queryKey(input)` or `key()` prefix. Generated HTTP query functions pass the signal to the supplied runner. The default Effect runner interrupts the ready HttpApiClient. A fetch transport aborts its pending request. Custom runners must forward the signal to preserve this behavior. TanStack retains its native query-cancellation result and cache policy.

HTTP interruption cooperatively stops local client execution. A closed connection does not prove that server work stopped or undo a completed write. For durable server cancellation, provide an application operation with an identity assigned before work begins. Reversing completed work requires a separate compensation operation.

HTTP mutations receive no query abort signal and keep TanStack's normal mutation lifecycle.

## Request server cancellation explicitly

Generated mutations receive no query abort signal. When long-running server work must be cancellable, assign an operation ID before starting it and provide an application operation that requests cancellation. Observe its terminal domain state through a separate read.

An interrupted client or closed HTTP connection does not establish remote completion. Cancellation requests cooperatively stop future work. Completed work needs a separate compensation operation. Use an application acknowledgement when you must wait for server cleanup.

The [Cancellable Commands example](/effect-api-query/examples/cancellable-commands/) shows one protocol with start, status, and cancel operations. It also covers retries with the same operation ID, concurrent commands, and the limits of its in-memory workers.

## Release resources after local cleanup

Cancel a query before releasing its services. Native `cancelQueries` can settle before asynchronous iterator finalizers finish. Keep the ready client, its Scope, and the runner alive until the application's cleanup signals settle. Mutations settle independently because they have no query abort signal.

A refetch can start a replacement stream while the old iterator's asynchronous finalizer is still pending. Awaiting `cancelQueries` or starting a refetch therefore does not establish an exclusive handoff. When streams share an exclusive resource, put acquisition and final release behind one application-owned lock. Every start path, including automatic refetch, must use it. Release the lock only after cleanup completes. During manual owner shutdown, await the old stream's cleanup signal before acquiring replacement resources.

For accumulated queries with `publicationBatchSize`, cancellation discards events still waiting for publication. Native cancellation controls whether already published data is retained or reverted. For [recovered application streams](/effect-api-query/guides/reconnect-streams/), interrupt the consuming Effect to stop active consumption, retry backoff, or a replay refresh. Wait for local finalizers before disposing the ready client and runtime. Local cleanup does not acknowledge remote cleanup.

Follow [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for disposal. Use [Stream Snapshots](/effect-api-query/guides/stream-snapshots/) for a finite capture that waits for local iterator cleanup before it settles.
