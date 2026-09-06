---
title: Quick Start
description: Create an RPC utility tree and use it with TanStack Query.
---

Start with an Effect RPC group and a ready flat RPC client. The application creates and disposes the
client; `effect-api-query` only derives Query Core utilities from it.

## Create and use the utilities

The `contracts.js` and `rpc-client.js` imports represent application-owned modules. Replace them
with the modules that define your RPC group and acquire your ready client.

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { createRpcQueryUtils } from 'effect-api-query'

import { exampleRpcGroup } from './contracts.js'
import { startExampleRpcClient } from './rpc-client.js'

const rpcClient = await startExampleRpcClient('/rpc')
const queryClient = new QueryClient()

const rpcQuery = createRpcQueryUtils(exampleRpcGroup, {
  client: rpcClient.client,
  keyPrefix: ['my-app'] as const,
  runPromiseExit: rpcClient.runPromiseExit,
})

const users = await queryClient.query(rpcQuery.users.list.queryOptions())
const user = await queryClient.query(rpcQuery.users.get.queryOptions({ input: { id: 1 } }))

const createUser = new MutationObserver(queryClient, rpcQuery.users.create.mutationOptions())
await createUser.mutate({ name: 'Ada' })
```

## Follow the generated tree

Dotted tags become nested paths: `users.get` becomes `rpcQuery.users.get`. Each unary RPC leaf has
`key`, `queryKey`, `infiniteKey`, `mutationKey`, `queryOptions`, `infiniteOptions`, and
`mutationOptions` builders.

Streaming leaves instead expose `key`, `streamedKey`, `streamedOptions`, `liveKey`, and `liveOptions`.

## Dispose application resources

When the application stops, cancel active queries before disposing the ready RPC client:

```ts
await queryClient.cancelQueries()
queryClient.clear()
await rpcClient.dispose()
```

See [Client Lifecycle](/effect-rpc-query/concepts/client-lifecycle/) for the ownership boundary and
[Generated Builders](/effect-rpc-query/reference/generated-builders/) for every leaf method. To
inspect complete applications, [run the examples](/effect-rpc-query/examples/).
