---
title: RPC Quick Start
description: Acquire an RPC client and use generated query and mutation options.
---

[Install the package](/effect-api-query/getting-started/installation/) before starting.
The server must serve the `usersRpc` contract at `http://localhost:3000/rpc` with Effect's JSON RPC protocol.
The server and browser application must share the same contract.

## Define the shared contract

Place the declaration in `rpc-contract.ts`. Both the server and client import this module.

Shared contract in `rpc-contract.ts`:

```ts
import { Effect, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

const User = Schema.Struct({ id: Schema.Int, name: Schema.String })
export const usersRpc = RpcGroup.make(
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
```

## Acquire the client and execute requests

The client module acquires a ready flat client, reads a user, and creates a user.
It then releases its resources. Replace the URL with your server's RPC endpoint.

Client integration in `client.ts`:

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, Exit, Layer, Scope } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { FetchHttpClient } from 'effect/http'
import { RpcClient, RpcSerialization } from 'effect/rpc'

import { usersRpc } from './rpc-contract.ts'

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

Dotted tags become nested paths. For example, `users.get` becomes `rpc.users.get`.
The factory uses `Effect.runPromiseExit` by default. If execution needs services, supply a signal-aware `runPromiseExit`.
Keep the client's Scope and runner alive while you use the utilities.

Query input is the RPC payload's constructor input. The input `{ id: 1 }` works because the constructor supplies `locale: 'en'`.
Defaults must be deterministic because key preparation and client execution construct the payload separately.
The decoded response is the query data. Each mutation receives its own variables when `mutate` runs.

Your application decides which queries to invalidate. This example refreshes all `users` reads after creation.
If a user or tenant identity affects the returned data, include a safe identifier in `keyPrefix`.
Keep credentials out of keys. RPC and HTTP keys have separate namespaces.

## Keep a browser client alive

This client module finishes each operation before disposing its resources.
In an application, acquire the client once before mounting components and release it after unmounting them. Use the
[React client setup](/effect-api-query/guides/react-query/#acquire-and-mount-the-client) for a provider, component,
and cleanup callback. Its HTTP client setup can be replaced with the RPC acquisition above.

Before disposing clients that serve streams or concurrent mutations, stop their consumers.
Wait for queries, local stream cleanup, and accepted mutations to finish before releasing the clients. Follow
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/).
For hooks, continue with [React Query](/effect-api-query/guides/react-query/).
For method and input contracts, use [RPC Builders](/effect-api-query/reference/generated-builders/).
