---
title: Cancellable Commands
description: Run the example's explicit command protocol without treating mutation cancellation as rollback.
---

This example runs long-running server work with an operation ID, progress updates, and an explicit cancellation request.
Run the
[Vite React example](/effect-api-query/examples/#run-vite-react) and use the **Cancellable commands**
panel. The Start application serves the same contract and handlers.

The library supplies generated query and mutation options.
The application defines the command protocol, owns the server workers, and decides how to report progress and retain records.
For query signals and iterator cleanup, see the [Cancellation contract](/effect-api-query/guides/cancellation/).

## Cancel a command while its mutation is pending

Use an explicit cancel RPC for long-running commands. The Vite React example provides
`commands.start`, `commands.status`, and `commands.cancel` in the shared contract. Each command
has an operation ID that the client generates. The start mutation waits for a terminal result.
A separate query observes progress, and a separate mutation requests cancellation.

In the React component, import `useState`, `useQuery`, and `useMutation` from their native packages.
Use the example's ready `rpcQuery` and QueryClient:

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

Disable start while the start mutation is pending, after success, or when status confirms an accepted command.
If start fails and no command was accepted, retry with the same operation ID.
An uncertain response must not create a second command.
Disable cancel before start, while cancellation is pending, or after a terminal status. The
[complete command panel](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/components/sections/commands-section.tsx)
includes the UI.

The cancel handler signals the worker and waits until it stops. The cancel mutation's
`onSettled` callback then invalidates the generated status key. The active query refetches the
server's status even if the cancel request failed.
Keep polling while a command runs or a status read remains unresolved or failed.
Stop at a terminal status, or when a settled start has no corresponding command.
The application chooses which status queries to invalidate.

A cancelled command returns `{ state: 'cancelled', ... }` successfully. TanStack therefore reports
both mutations as `success` and runs their normal callbacks.
The domain state does not add a `cancelled` MutationCache state.
Each operation ID has its own query key and worker. Cancelling one command leaves another running.

The TanStack Start application hosts the same contract and handlers at `/rpc`.
Its `application.rpcQuery.commands` exposes the same options for hooks, loaders, and QueryClient.
Start can reuse this workflow with its own QueryClient.

## Choose what cancellation means

| Action                    | Result                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| Stop observing a query    | Removes local observation. Whether work stops depends on the query lifecycle and transport. |
| Interrupt an Effect       | Requests cooperative interruption and runs its finalizers.                                  |
| Call `commands.cancel`    | Requests cooperative server cancellation by operation ID and waits for a terminal state.    |
| Compensate committed work | Requires a separate application operation that reverses or offsets prior effects.           |

Transport interruption is cooperative and requires transport support.
An explicit cancel RPC gives the application a contract for requesting server cancellation.
When its local Effect is interrupted, the slow-query demo calls the transport-specific `diagnostics.cancel` operation.
The package does not provide that behavior.

The command example owns workers in the server Scope. Unmounting a view or interrupting the
client's wait does not cancel these workers automatically.
A cancel request stops future steps. Completed steps remain recorded.
Cancellation after completion returns the completed result without rolling it back.
Repeating a start with the same ID returns the existing result.
If cancel arrives before start, the server reserves that ID as cancelled.

This example stores operation records in memory until the example is reset or the server stops.
If operations must survive restarts, production applications need authorization, durable storage, and a retention policy.
The example's in-memory records do not provide a durable job queue.
