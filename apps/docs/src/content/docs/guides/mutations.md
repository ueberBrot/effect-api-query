---
title: Mutations
description: Run a typed RPC or HTTP mutation and invalidate affected queries.
---

Use the utilities from the [RPC quick start](/effect-api-query/getting-started/quick-start/) or [HTTP quick start](/effect-api-query/getting-started/http-quick-start/). Here `users.create` takes a name and returns a user. To call it outside a component, import `MutationObserver` from `@tanstack/query-core`.

## Execute a write

Build the options once. Pass variables to each `mutate` call.

```ts
const createUser = new MutationObserver(
  queryClient,
  rpc.users.create.mutationOptions({
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: rpc.users.key() }),
  })
);
const created = await createUser.mutate({ name: "Ada" });
```

For HTTP, pass the full decoded request as the mutation variables.

```ts
const createHttpUser = new MutationObserver(
  queryClient,
  http.users.create.mutationOptions({
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: http.users.key() }),
  })
);
const createdHttpUser = await createHttpUser.mutate({
  payload: { name: "Ada" },
});
```

Pass the same options to native mutation hooks. Callbacks infer the result, variables, and execution error types. Mutation keys identify the operation. They exclude variables. A successful mutation can return `undefined`.

## Choose cache updates

The examples mark the affected user queries stale. TanStack Query refetches active matches by default. You can also use `setQueryData` with a known result, or apply an [optimistic write](/effect-api-query/guides/optimistic-writes/) before the response arrives.

Use a mutation for [buffered HTTP uploads](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file). See [handle failures](/effect-api-query/guides/handle-failures/) for errors and [cancellation](/effect-api-query/guides/cancellation/#request-server-cancellation-explicitly) for long-running writes.
