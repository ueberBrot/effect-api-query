---
title: Cancellable Commands
description: Run the example's explicit command protocol without treating mutation cancellation as rollback.
---

Open the "Cancellable commands" panel in the [Vite React app](/effect-api-query/examples/#run-vite-react). The Start app serves the same operations.

The app defines the command IDs, progress, workers, and records. The library builds query and mutation options. See [cancellation](/effect-api-query/guides/cancellation/) for local query signals and cleanup.

## Cancel a command while its mutation is pending

The client assigns an ID before starting each command. The server scopes IDs to a verified caller. The browser uses a same-origin operation session that grants access to its commands and diagnostics.

In the React component, use the app's `rpcQuery` and QueryClient. Import `useState`, `useQuery`, and `useMutation` from their native packages.

```ts
import { isOperationNotFound } from "@effect-api-query/shared/operation-errors.ts";

const [operationId] = useState(() => crypto.randomUUID());
const input = { operationId };
const [reserved, setReserved] = useState(false);
const statusKey = rpcQuery.commands.status.queryKey({ input });
const reconcile = async () => {
  const previous = queryClient.getQueryState(statusKey);
  if (previous?.status === "error") {
    return;
  }
  const filter = { queryKey: statusKey, exact: true };
  await queryClient.invalidateQueries(filter, { cancelRefetch: false });
  const latest = queryClient.getQueryState(statusKey);
  if (
    previous?.fetchStatus === "fetching" &&
    latest?.fetchStatus === "idle" &&
    latest.status === "success" &&
    latest.data === null
  ) {
    await queryClient.refetchQueries(
      { ...filter, type: "active" },
      { cancelRefetch: false }
    );
  }
};

const start = useMutation(
  rpcQuery.commands.start.mutationOptions({
    onMutate: async () => {
      await rpcQuery.commands.reserve.call({ input });
      setReserved(true);
    },
    onSettled: reconcile,
  })
);
const cancel = useMutation(
  rpcQuery.commands.cancel.mutationOptions({ onSettled: reconcile })
);
const status = useQuery(
  rpcQuery.commands.status.queryOptions({
    input,
    enabled: reserved,
    retry: (failureCount, error) =>
      failureCount < 3 && !isOperationNotFound(error),
    retryDelay: (attempt) => 250 * 2 ** attempt,
    refetchOnWindowFocus: (query) => query.state.status !== "error",
    refetchOnReconnect: (query) => query.state.status !== "error",
    refetchInterval: (query) =>
      query.state.status !== "error" &&
      query.state.fetchStatus === "idle" &&
      (query.state.data?.state === "running" ||
        query.state.data === undefined ||
        (query.state.data === null && start.isPending))
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

Disable Start while it is pending or once the server accepts the command. If Start fails or the response is uncertain, reuse the same ID while the server still retains the record. Disable Cancel until `reserved` is true, during cancellation, and after terminal status. See the [complete panel](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/components/sections/commands-section.tsx).

The cancel handler signals the worker and waits for it to stop. Both mutations reconcile the active status query in `onSettled` while automatic status recovery is available. If reconciliation joins an in-flight request and that request only reports the reservation, read status again after the mutation response. Poll while the command runs or status is unresolved. Stop at terminal status, a missing operation, or when Start has settled and only the reservation remains.

A failed status fetch retries after 250, 500, and 1,000 ms. Exhausting those retries pauses automatic polling. Show **Refresh status** when `status.isError && !isOperationNotFound(status.error)`, disable it while `status.fetchStatus !== "idle"`, and call `status.refetch()` when clicked. A successful refresh resumes polling if the command is still running.

A cancelled command returns `{ state: 'cancelled', ... }` as a successful result. TanStack reports the mutations as `success`. Use the command state for the UI. Each ID has a separate query and worker, so cancelling one leaves the other running.

Start serves the same handlers at `/rpc`. Use `application.rpcQuery.commands` with the Start app's QueryClient.

## Choose what cancellation means

| Action | Result |
| --- | --- |
| Stop observing a query | Removes local observation. Whether work stops depends on the query lifecycle and transport. |
| Interrupt an Effect | Requests cooperative interruption and runs its finalizers. |
| Call `commands.cancel` | Requests cooperative cancellation for a command owned by the verified caller and waits for a terminal state. |
| Compensate committed work | Requires a separate application operation that reverses or offsets prior effects. |

Transport interruption requires transport support. The slow-query demo explicitly calls `diagnostics.cancel` when its local Effect is interrupted. Define an operation like this if the server needs an explicit cancellation request. The example checks completion and interruption counts for that run so a Cancel click during response delivery can still report that the server finished. If the status record has already been evicted, the panel reports that the server outcome is unavailable and lets the caller start a new run.

The server Scope owns the workers, which can continue after a view unmounts. Cancelling stops future steps and keeps completed steps. If the server still has the record, Cancel returns its terminal result and a duplicate Start reuses the same work. After reservation, Cancel can arrive before Start and settle the command as cancelled. Looking up or cancelling a missing record returns `operation-not-found`.

The example admits up to eight running commands per caller and 32 per host. Operation IDs can contain up to 100 characters. Reservations have their own capacity of eight per caller and 256 per host. A cancellation before Start stays in its reservation slot until Start arrives or the reservation expires two hours after creation. A new start or reservation at capacity returns `operation-capacity-exceeded`.

Running commands stay available through settlement. The host retains the 256 newest terminal records. Once a terminal record is evicted, starting its ID again can create a new command. Reset and shutdown clear the in-memory records. If records must survive restarts, add authorization, durable storage, and a retention policy.
