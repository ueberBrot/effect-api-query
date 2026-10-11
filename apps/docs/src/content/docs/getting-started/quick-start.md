---
title: RPC Quick Start
description: Acquire an RPC client and use generated query and mutation options.
---

First [install the package](/effect-api-query/getting-started/installation/). The server must
serve the same `usersRpc` contract at `http://localhost:3000/rpc` with Effect's JSON RPC protocol.
Share the contract between your server and browser application.

## Acquire the client and execute requests

This complete module defines the contract, acquires a ready flat client, reads a user, writes a
user, and releases its resources. Replace the URL with your server's RPC endpoint.

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { FetchHttpClient } from 'effect/http'
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from 'effect/rpc'

const User = Schema.Struct({ id: Schema.Int, name: Schema.String })
const usersRpc = RpcGroup.make(
  Rpc.make('users.get', {
    payload: {
      id: Schema.Int,
      locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))),
    },
    success: User,
  }),
  Rpc.make('users.create', {
    payload: { name: Schema.String },
    success: User,
  }),
)

const protocol = RpcClient.layerProtocolHttp({ url: 'http://localhost:3000/rpc' }).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer),
)
const scope = await Effect.runPromise(Scope.make())
const queryClient = new QueryClient()

try {
  const client = await Effect.runPromise(
    RpcClient.make(usersRpc, { flatten: true }).pipe(
      Effect.provide(protocol),
      Scope.provide(scope),
    ),
  )
  const rpc = createRpcQueryUtils(usersRpc, {
    client,
    keyPrefix: ['users-app'] as const,
  })

  const user = await queryClient.query(rpc.users.get.queryOptions({ input: { id: 1 } }))
  console.log(user.name)

  const createUser = new MutationObserver(queryClient, rpc.users.create.mutationOptions())
  const created = await createUser.mutate({ name: 'Ada' })
  console.log(created.id)
  await queryClient.invalidateQueries({ queryKey: rpc.users.key() })
} finally {
  try {
    await queryClient.cancelQueries()
  } finally {
    queryClient.clear()
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
}
```

Dotted tags become nested paths: `users.get` becomes `rpc.users.get`. The factory uses
`Effect.runPromiseExit` by default; supply a signal-aware `runPromiseExit` when execution needs
services. Keep the client's Scope and runner alive while the utilities are used.

Query input is the RPC payload's **constructor input**: `{ id: 1 }` works because its constructor
supplies `locale: 'en'`. Defaults must be deterministic because key preparation and client execution
construct the payload separately. The decoded response is the query data; each mutation receives
its own variables when `mutate` runs.

Invalidation is application policy. This example refreshes all `users` reads after creation.
A safe user or tenant identity belongs in `keyPrefix` when it affects returned data; credentials
do not. RPC and HTTP keys have separate namespaces.

## Keep a browser client alive

The module above finishes each operation before disposing its resources. For an application,
acquire once before mounting components and release after unmounting them. Use the
[React client setup](/effect-api-query/guides/react-query/#acquire-and-mount-the-client) for a provider, component,
and cleanup callback. Its HTTP client setup can be replaced with the RPC acquisition above.

Before disposing clients that also serve streams or concurrent mutations, stop consumers and
drain queries, local stream cleanup, and accepted mutations. Follow
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/).
For hooks, continue with [React Query](/effect-api-query/guides/react-query/); for exact method
and input contracts, use [RPC Builders](/effect-api-query/reference/generated-builders/).
