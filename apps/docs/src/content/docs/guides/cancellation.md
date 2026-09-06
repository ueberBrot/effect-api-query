---
title: Cancellation
description: Cancel queries and request server-side cancellation for long-running commands.
---

Generated query functions forward TanStack's `AbortSignal` to `runPromiseExit`:

```ts
const runPromiseExit: RunPromiseExit = (effect, options) => runtime.runPromiseExit(effect, options)
```

Cancel one request with its generated query key:

```ts
const input = { durationMs: 60_000, operationId: 'slow-query' }

void queryClient.query(rpcQuery.diagnostics.slow.queryOptions({ input }))

await queryClient.cancelQueries({
  queryKey: rpcQuery.diagnostics.slow.queryKey(input),
})
```

TanStack aborts the signal. The runner must translate that abort into Effect interruption, and the
RPC transport must support interruption if the server operation should stop. `effect-rpc-query`
does not add a transport-specific cancellation protocol.

Infinite page requests, accumulated streams, and live queries use the same signal. Cancelling a
stream query also calls `return()` on its AsyncIterator, which runs the Effect stream's finalizers.
TanStack also cancels an active stream when its last observer unmounts or a refetch supersedes it.

Mutations do not receive TanStack query signals, so the generated mutation function provides no
automatic mutation cancellation helper.

## Cancel an HTTP query

Use `queryClient.cancelQueries` with the HTTP endpoint's generated `queryKey(input)` or `key()`
prefix. Generated HTTP query functions pass the signal to the supplied runner; the default Effect
runner interrupts the ready HttpApiClient, and a fetch transport aborts its pending request.
Custom runners must forward the signal to preserve this behavior. TanStack retains its native
query-cancellation result and cache policy.

HTTP interruption stops local client execution cooperatively. A closed connection does not prove
that server work stopped, and it does not undo a completed write. Durable server cancellation needs
an explicit application operation identified before work begins; compensation remains separate.
HTTP mutations receive no query abort signal and keep TanStack's normal mutation lifecycle.

## Cancel a command while its mutation is pending

Use an explicit cancel RPC for long-running commands. The Vite React example provides
`commands.start`, `commands.status`, and `commands.cancel` in the shared contract. Each command
has a client-generated operation ID. The start mutation waits for a terminal result; a separate
query observes progress, and a separate mutation requests cancellation.

```tsx
const [operationId] = useState(() => crypto.randomUUID())
const input = { operationId }
const reconcile = async () => {
  await queryClient.invalidateQueries({
    queryKey: rpcQuery.commands.status.queryKey(input),
  })
}

const start = useMutation(rpcQuery.commands.start.mutationOptions({ onSettled: reconcile }))
const cancel = useMutation(rpcQuery.commands.cancel.mutationOptions({ onSettled: reconcile }))
const status = useQuery(
  rpcQuery.commands.status.queryOptions({
    input,
    enabled: start.status !== 'idle',
    refetchInterval: (query) =>
      query.state.data == null || query.state.data.state === 'running' ? 100 : false,
  }),
)

return (
  <>
    <button onClick={() => start.mutate(input)} disabled={start.status !== 'idle'}>
      Start command
    </button>
    <button
      onClick={() => cancel.mutate(input)}
      disabled={
        start.status === 'idle' ||
        cancel.isPending ||
        status.data?.state === 'completed' ||
        status.data?.state === 'cancelled'
      }
    >
      Cancel command
    </button>
    <p>Server state: {status.data?.state ?? 'not started'}</p>
  </>
)
```

The cancel handler signals the worker and waits until it has stopped. Its `onSettled` callback
invalidates the generated status key, so the active query refetches the server's status even if the cancel
request failed. Polling stops at a terminal state. The application chooses this invalidation policy.

A cancelled command returns `{ state: 'cancelled', ... }` successfully. TanStack therefore reports
both mutations as `success` and runs their normal callbacks. The domain state does not add a
`cancelled` MutationCache state. Each operation ID has its own query key and worker, so cancelling
one command leaves another running.

Run the Vite React example and use the **Cancellable commands** panel to try two concurrent
commands. The TanStack Start application hosts the same contract and handlers at `/rpc`; its
`application.rpcQuery.commands` exposes these same framework-neutral options for hooks, loaders,
and QueryClient. It can reuse the workflow above with its own QueryClient.

## Choose what cancellation means

| Action                    | Result                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| Stop observing a query    | Removes local observation; whether work stops depends on the query lifecycle and transport. |
| Interrupt an Effect       | Requests cooperative interruption and runs its finalizers.                                  |
| Call `commands.cancel`    | Requests cooperative server cancellation by operation ID and waits for a terminal state.    |
| Compensate committed work | Requires a separate application operation that reverses or offsets prior effects.           |

Transport interruption is cooperative and transport-dependent. An explicit cancel RPC is the
durable application contract for requesting server cancellation. The existing slow-query demo
adds a transport-specific `diagnostics.cancel` call when its local Effect is interrupted; the
package itself does not provide that behavior.

The command example owns workers in the server Scope. Unmounting a view or interrupting the
client's wait does not cancel these workers automatically. A cancel request stops future steps;
completed steps remain recorded. Cancellation after completion returns the completed result and
promises no rollback. Repeating a start with the same ID returns the existing result; a cancel
that arrives before start reserves that ID as cancelled.

This example stores operation records in memory until the example is reset or the server stops.
Production applications need their own authorization, durable storage, and retention policy if
operations must survive restarts. The explicit RPC contract does not make this in-memory example
a durable job queue.
