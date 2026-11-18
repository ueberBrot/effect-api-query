---
title: Cancellable Commands
description: Run the example's explicit command protocol without treating mutation cancellation as rollback.
---

Open the **Cancellable commands** panel in the [Vite React app](/effect-api-query/examples/#run-vite-react). The Start app serves the same operations.

The app defines the command IDs, progress, workers, and records. The library builds query and mutation options. See [cancellation](/effect-api-query/guides/cancellation/) for local query signals and cleanup.

## Cancel a command while its mutation is pending

The client assigns an ID before starting each command. `commands.start` waits for the terminal result. `commands.status` shows progress. `commands.cancel` requests cancellation.

In the React component, use the app's `rpcQuery` and QueryClient. Import `useState`, `useQuery`, and `useMutation` from their native packages.

```ts
const [operationId] = useState(() => crypto.randomUUID());
const input = { operationId };
const reconcile = async () => {
  await queryClient.invalidateQueries({
    queryKey: rpcQuery.commands.status.queryKey(input),
  });
};

const start = useMutation(
  rpcQuery.commands.start.mutationOptions({ onSettled: reconcile })
);
const cancel = useMutation(
  rpcQuery.commands.cancel.mutationOptions({ onSettled: reconcile })
);
const status = useQuery(
  rpcQuery.commands.status.queryOptions({
    input,
    enabled: start.status !== "idle",
    refetchInterval: (query) =>
      query.state.data?.state === "running" ||
      query.state.status === "error" ||
      query.state.data === undefined ||
      (query.state.data === null && start.isPending)
        ? 100
        : false,
  })
);
```

Call the matching mutation from each button handler.

```ts
start.mutate(input);
cancel.mutate(input);
```

Disable Start while it is pending or once the server accepts the command. If Start fails or the response is uncertain, reuse the same ID so a retry cannot create another command. Disable Cancel before Start, during cancellation, and after terminal status. See the [complete panel](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/components/sections/commands-section.tsx).

The cancel handler signals the worker and waits for it to stop. Its mutation invalidates the status key in `onSettled`, so the active query refetches even if cancellation failed. Poll while the command runs or status is unresolved. Stop at terminal status or when a settled Start has no command.

A cancelled command returns `{ state: 'cancelled', ... }` as a successful result. TanStack reports the mutations as `success`. Use the command state for the UI. Each ID has a separate query and worker, so cancelling one leaves the other running.

Start serves the same handlers at `/rpc`. Use `application.rpcQuery.commands` with the Start app's QueryClient.

## Choose what cancellation means

| Action | Result |
| --- | --- |
| Stop observing a query | Removes local observation. Whether work stops depends on the query lifecycle and transport. |
| Interrupt an Effect | Requests cooperative interruption and runs its finalizers. |
| Call `commands.cancel` | Requests cooperative server cancellation by operation ID and waits for a terminal state. |
| Compensate committed work | Requires a separate application operation that reverses or offsets prior effects. |

Transport interruption requires transport support. The slow-query demo explicitly calls `diagnostics.cancel` when its local Effect is interrupted. Define an operation like this if the server needs an explicit cancellation request.

The server Scope owns the workers, which can continue after a view unmounts. Cancelling stops future steps and keeps completed steps. If work already finished, cancel returns its completed result. A duplicate Start returns the existing result. If Cancel arrives first, the server reserves the ID as cancelled.

The demo keeps records in memory until reset or shutdown. If records must survive restarts, add authorization, durable storage, and a retention policy.
