---
title: RPC Quick Start
description: Declare an RPC group, own a ready client, and run a generated query and mutation.
---

This tutorial connects an Effect RPC client to TanStack Query Core. You will declare two operations,
acquire a ready flat client, read a user, and create another user.

First [install the package](/effect-api-query/getting-started/installation/). Use a server that
implements the declaration below at `http://localhost:3000/rpc` with JSON RPC serialization and
an existing user with ID `1`. Change the URL to your server; browser callers also need its CORS policy
to allow their origin. For a complete server and browser application, [run the examples](/effect-api-query/examples/).

## Declare, connect, and call

Save this as `rpc-client.ts` in your application. The declaration belongs in a shared module when
you connect your own server and client. Only the client application imports `effect-api-query`.

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { FetchHttpClient } from 'effect/unstable/http'
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from 'effect/unstable/rpc'

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

`RpcClient.make(..., { flatten: true })` acquires the ready client inside the application's scope.
The factory derives the utility tree from that client and uses `Effect.runPromiseExit`
unless you supply a custom runner.

The query accepts the RPC payload's **constructor input**. Here `{ id: 1 }` is valid because the
schema constructor supplies `locale: 'en'`. Use deterministic constructor defaults: key preparation
and ready-client execution construct the payload separately.

Dotted RPC tags become nested properties: `users.get` becomes `rpc.users.get`. The query returns
a decoded user. Mutation variables arrive at `mutate`, and invalidation explicitly refreshes the
cached reads affected by the write.

## Keep the owner alive

The `finally` block cancels queries, clears their cache, and closes the client scope even when a
call fails. This short program waits for its mutation before cleanup. In a UI, keep the owner alive
for the application lifetime and settle pending mutations before disposal; query cancellation does
not cancel mutations.

Use a safe user or tenant identity in `keyPrefix` when client configuration affects which data
the client can return. See [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) and
[Cache Keys](/effect-api-query/concepts/semantic-keys/) before sharing clients or caches.

The repository compiles this complete snippet against the public package root in
[`tests/types/docs-rpc-quick-start.ts`](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-rpc-quick-start.ts)
and checks that this page matches it. Continue with
[queries and mutations](/effect-api-query/concepts/queries-and-mutations/) or the
[generated RPC builders](/effect-api-query/reference/generated-builders/).
