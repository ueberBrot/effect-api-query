---
title: Mutations
description: Build typed RPC and HTTP writes and refresh affected queries.
---

Use your ready utility tree and QueryClient from the [RPC quick start](/effect-api-query/getting-started/quick-start/)
or [HTTP quick start](/effect-api-query/getting-started/http-quick-start/).
The examples assume `users.create` accepts a `name` and returns a user with `id` and `name`.
Import `MutationObserver` from `@tanstack/query-core` for imperative execution.

## Execute a write

Build options once, then supply each mutation's variables when it runs:

```ts
const createUser = new MutationObserver(
  queryClient,
  rpc.users.create.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rpc.users.key() }),
  }),
)
const created = await createUser.mutate({ name: 'Ada' })
```

HTTP variables contain the complete decoded request:

```ts
const createHttpUser = new MutationObserver(
  queryClient,
  http.users.create.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: http.users.key() }),
  }),
)
const createdHttpUser = await createHttpUser.mutate({ payload: { name: 'Ada' } })
```

Native mutation hooks accept the same options. Callbacks infer the result, variables, and
execution errors. Mutation keys identify the operation and exclude variables. Successful
`undefined` remains `undefined`.

## Choose cache updates

Writes refresh reads through your callback policy. Invalidate affected generated prefixes,
seed a known result with `setQueryData`, or apply an
[optimistic write](/effect-api-query/guides/optimistic-writes/).
The library derives builders from the contract; the call site chooses read or write semantics.
Buffered multipart endpoints support mutations only.

See [HTTP uploads](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file),
[Handle Failures](/effect-api-query/guides/handle-failures/), and
[Cancellation](/effect-api-query/guides/cancellation/) for their execution boundaries.
