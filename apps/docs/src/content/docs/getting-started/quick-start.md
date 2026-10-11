---
title: RPC Quick Start
description: Turn an existing RPC contract and ready client into query and mutation options.
---

Use an existing `RpcGroup`, a ready flat RPC client, and a `QueryClient`. This example's
`usersRpc` declares `users.get` with an `id` and default `locale: 'en'`, plus `users.create`
with a `name`. First [install the package](/effect-api-query/getting-started/installation/).

Import `createRpcQueryUtils` from `effect-api-query` and `MutationObserver` from
`@tanstack/query-core`. For the contract, transport and client acquisition, see the
[tests/types/docs-rpc-quick-start.ts](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-rpc-quick-start.ts)
or [run the application examples](/effect-api-query/examples/).

## Create the utilities

In the application client module, after acquiring the flat client:

```ts
const rpc = createRpcQueryUtils(usersRpc, {
  client,
  keyPrefix: ['users-app'] as const,
})
```

Dotted tags become nested paths: `users.get` becomes `rpc.users.get`. The factory uses
`Effect.runPromiseExit` by default; supply `runPromiseExit` when execution needs services.
Keep the client's `Scope` and runner alive while the utilities are used.

## Query a user

In a loader or event handler, use the existing `queryClient`:

```ts
const user = await queryClient.query(rpc.users.get.queryOptions({ input: { id: 1 } }))
```

The result is a decoded user. Query input is the RPC payload's **constructor input**:
`{ id: 1 }` works because its constructor supplies `locale: 'en'`. Defaults must be
deterministic because key preparation and client execution construct the payload separately.

## Execute a write

Create mutation options beside the same client; pass each execution's input to `mutate`:

```ts
const createUser = new MutationObserver(queryClient, rpc.users.create.mutationOptions())
const created = await createUser.mutate({ name: 'Ada' })
```

After success, refresh the reads affected by that write:

```ts
await queryClient.invalidateQueries({ queryKey: rpc.users.key() })
```

Invalidation is application policy. A safe user or tenant identity belongs in `keyPrefix`
when it affects returned data; credentials do not. Before disposing the client, stop
consumers and drain queries, local stream cleanup and accepted mutations. Follow
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/).

For hooks, continue with [React Query](/effect-api-query/guides/react-query/); for exact
method and input contracts, use [RPC Builders](/effect-api-query/reference/generated-builders/).
