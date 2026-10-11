---
title: Cancellation
description: Cancel queries and request server-side cancellation for long-running commands.
---

In the application client module, forward TanStack's `AbortSignal` to your runtime.
Import `RunPromiseExit` from `effect-api-query`:

```ts
const runPromiseExit: RunPromiseExit = (effect, options) => runtime.runPromiseExit(effect, options)
```

In a loader or event handler using the ready RPC utility tree, cancel one request with its generated key:

```ts
const input = { durationMs: 60_000, operationId: 'slow-query' }

void queryClient.query(rpcQuery.diagnostics.slow.queryOptions({ input }))

await queryClient.cancelQueries({
  queryKey: rpcQuery.diagnostics.slow.queryKey(input),
})
```

TanStack aborts the signal. The runner must translate that abort into Effect interruption, and the
RPC transport must support interruption if the server operation should stop. `effect-api-query`
does not add a transport-specific cancellation protocol.

Infinite page requests, accumulated streams, and live queries use the same signal. Cancelling a
stream query also calls `return()` on its AsyncIterator, which runs the Effect stream's finalizers.
TanStack also cancels an active stream when its last observer unmounts or a refetch supersedes it.

These cancellation guarantees apply to ordinary query observers. TanStack documents that
cancellation does not work with `useSuspenseQuery`, `useSuspenseQueries`, and
`useSuspenseInfiniteQuery`; generated options and signal forwarding preserve that limitation.
Choose ordinary hooks when your screen depends on cancellation, particularly for open streams.
See [TanStack's limitations](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation#limitations)
and [Suspense and Error Recovery](/effect-api-query/guides/suspense-and-recovery/).

Mutations do not receive TanStack query signals, so generated mutation functions cannot cancel
a mutation automatically.

## Cancel an HTTP query

Use `queryClient.cancelQueries` with the HTTP endpoint's generated `queryKey(input)` or `key()`
prefix. Generated HTTP query functions pass the signal to the supplied runner; the default Effect
runner interrupts the ready HttpApiClient, and a fetch transport aborts its pending request.
Custom runners must forward the signal to preserve this behavior. TanStack retains its native
query-cancellation result and cache policy.

HTTP interruption stops local client execution cooperatively. A closed connection does not prove
that server work stopped, and it does not undo a completed write. Durable server cancellation
requires an explicit application operation with an identity assigned before work begins.
Reversing completed work requires a separate compensation operation.

HTTP mutations receive no query abort signal and keep TanStack's normal mutation lifecycle.

## Request server cancellation explicitly

Generated mutations receive no query abort signal. When long-running server work must be
cancellable, assign an operation ID before starting it and provide an application operation
that requests cancellation. Observe its terminal domain state through a separate read.

An interrupted client or closed HTTP connection does not establish remote completion. Cancellation
requests stop future work cooperatively; completed work needs a separate compensation operation.
Use an application acknowledgement when you must wait for server cleanup.

The [Cancellable Commands example](/effect-api-query/examples/cancellable-commands/) shows one
protocol with start, status, and cancel operations. It also covers retries with the same operation ID,
concurrent commands, and the limits of its in-memory workers.

## Release resources after local cleanup

Cancelling a query and releasing its services are separate steps. Native `cancelQueries` settlement
can precede asynchronous iterator finalizers. Keep the ready client, its Scope, and the runner alive
until application-owned cleanup signals settle. Mutations settle independently because they have
no query abort signal.

Follow [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for disposal. Use
[Stream Snapshots](/effect-api-query/guides/stream-snapshots/) for a finite capture that waits for
local iterator cleanup before it settles.
