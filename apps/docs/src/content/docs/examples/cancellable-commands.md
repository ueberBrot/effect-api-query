---
title: Cancellable Commands
description: Run the example's explicit command protocol without treating mutation cancellation as rollback.
---

This application workflow demonstrates long-running server work with an operation ID, observable
progress, and an explicit cancellation request. Run the
[Vite React example](/effect-api-query/examples/#run-vite-react) and use the **Cancellable commands**
panel. The Start application serves the same contract and handlers.

The library supplies ordinary generated query and mutation options. The application supplies the
command protocol, server workers, progress policy, and retention. For query signals and iterator
cleanup, see the [Cancellation contract](/effect-api-query/guides/cancellation/).

## Cancel a command while its mutation is pending

Use an explicit cancel RPC for long-running commands. The Vite React example provides
`commands.start`, `commands.status`, and `commands.cancel` in the shared contract. Each command
has a client-generated operation ID. The start mutation waits for a terminal result; a separate
query observes progress, and a separate mutation requests cancellation.

In the React component setup, import `useState`, `useQuery`, and `useMutation` from their native
packages. With the example's ready `rpcQuery` and QueryClient:

```ts
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
      query.state.data?.state === 'running' ||
      query.state.status === 'error' ||
      query.state.data === undefined ||
      (query.state.data === null && start.isPending)
        ? 100
        : false,
  }),
)
```

In the start and cancel button handlers, call the corresponding mutation:

```ts
start.mutate(input)
cancel.mutate(input)
```

Disable start while pending, after success, or when status confirms an accepted command.
After a failed start with no accepted command, retry with the same operation ID; an uncertain
response must not create a second command. Disable cancel before start, while cancellation is
pending, or after a terminal status. The
[complete command panel](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/components/sections/commands-section.tsx)
includes the UI.

The cancel handler signals the worker and waits until it has stopped. The cancel mutation's
`onSettled` callback then invalidates the generated status key. The active query refetches the
server's status even if the cancel request failed. Poll unresolved or failed status reads and
running commands. Stop at a terminal status, or when a settled start has no corresponding command.
The application chooses this invalidation policy.

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

Transport interruption is cooperative and depends on transport support. An explicit cancel RPC is the
durable application contract for requesting server cancellation. The slow-query demo
adds a transport-specific `diagnostics.cancel` call when its local Effect is interrupted; the
package itself does not provide that behavior.

The command example owns workers in the server Scope. Unmounting a view or interrupting the
client's wait does not cancel these workers automatically. A cancel request stops future steps;
completed steps remain recorded. Cancellation after completion returns the completed result without
promising a rollback. Repeating a start with the same ID returns the existing result; a cancel
that arrives before start reserves that ID as cancelled.

This example stores operation records in memory until the example is reset or the server stops.
Production applications need their own authorization, durable storage, and retention policy if
operations must survive restarts. The explicit RPC contract does not make this in-memory example
a durable job queue.
