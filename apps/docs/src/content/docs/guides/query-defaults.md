---
title: Query Defaults
description: Reuse QueryClient policies with generated prefixes and typed call-site options.
---

Configure common freshness and retry policies on your application-owned `QueryClient`. Use
generated prefixes to specialize those policies, then pass call-site options to the generated
builders. The utility tree owns keys and execution functions; QueryClient owns hashing.

Create the utility tree and QueryClient once for each cache owner. Keep the ready client's Scope
alive while its queries run. Use a request-local QueryClient during SSR and dispose application
resources through their owning runtime.

## Register RPC policies from broad to specific

This example disables retries globally, retries reads in the `users` branch twice, and keeps the
`users.get` query view fresh for two minutes. The call-site `refreshUser` options request an
immediate fetch without retries. `user` selects a name while the cache retains the full user.

```ts
import { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'

export const usersRpc = RpcGroup.make(
  Rpc.make('users.get', {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    error: Schema.TaggedStruct('RetryLater', {}),
  }),
)

export const createApplicationQueries = <ClientError>(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof usersRpc>, ClientError>,
) => {
  const rpc = createRpcQueryUtils<typeof usersRpc, readonly ['users-app'], ClientError>(usersRpc, {
    client,
    keyPrefix: ['users-app'],
  })
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 600_000, retry: false, retryDelay: 250 },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryDefaults(rpc.key(), { staleTime: 60_000 })
  queryClient.setQueryDefaults(rpc.users.key(), { retry: 2 })
  queryClient.setQueryDefaults([...rpc.users.get.key(), 'query'], { staleTime: 120_000 })

  const user = rpc.users.get.queryOptions({
    input: { id: 1 },
    select: (value) => value.name,
  })
  const refreshUser = rpc.users.get.queryOptions({
    input: { id: 1 },
    staleTime: 0,
    retry: false,
  })
  return { queryClient, rpc, user, refreshUser }
}
```

TanStack merges the QueryClient's global query defaults, every matching registered prefix in
registration order, and the explicit options passed to the builder. Register broader prefixes
first: TanStack does not sort them by specificity. Here the query inherits `gcTime: 600_000`,
`retry: 2`, and `staleTime: 120_000`. `refreshUser` overrides freshness and retries for that call.

`rpc.key()` covers the utility tree, `rpc.users.key()` covers its branch, and
`rpc.users.get.key()` covers the leaf. Appending `'query'` targets that leaf's ordinary query view
without applying its stale policy to an infinite or stream view. An operation prefix also covers
all inputs of that view. Mutation policies use native `setMutationDefaults` separately.

Omit an option to inherit its defaults. Use `staleTime: 0` to override an inherited freshness
policy with immediate staleness. QueryClient imperative fetches and observers can have different
built-in retry defaults, so set retry policy explicitly when attempts matter. `retry: 2` allows at
most three executions. For typed decisions
based on domain failures or transport errors, pass `retry` to the builder as shown in
[Retry Queries](/effect-api-query/guides/retry-queries/).

## Apply HTTP policies to separate views

HTTP prefixes use the same native APIs. This example retries the `users` group once, applies a
five-second stale time only to the metadata view, and hashes every view through QueryClient's
root-prefix policy. The ordinary query retains the global thirty-second stale time.

```ts
import { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import type { HttpApiClient } from 'effect/http-api'

export const usersApi = HttpApi.make('users').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
      error: Schema.TaggedStruct('RetryLater', {}).pipe(HttpApiSchema.status(503)),
    }),
  ),
)

export const createHttpApplicationQueries = (client: HttpApiClient.ForApi<typeof usersApi>) => {
  const http = createHttpApiQueryUtils(usersApi, { client, keyPrefix: ['users-app'] })
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false, retryDelay: 250 },
    },
  })
  queryClient.setQueryDefaults(http.key(), {
    queryKeyHashFn: (key) => `users:${JSON.stringify(key)}`,
  })
  queryClient.setQueryDefaults(http.users.key(), { retry: 1 })
  queryClient.setQueryDefaults([...http.users.get.key(), 'metadata'], { staleTime: 5_000 })

  const input = { params: { id: 1 } }
  const user = http.users.get.queryOptions({ input })
  const metadata = http.users.get.metadataOptions({ input })
  return { queryClient, http, user, metadata }
}
```

The ordinary and metadata views have separate keys. Configure global or prefix `queryKeyHashFn`
on QueryClient before using the cache, and keep it stable for the cache owner's lifetime. Generated
options retain their own query function even if a prefix registers another one. Builders reject
per-call `queryHash` and `queryKeyHashFn` because native key-only reads and writes must resolve the
same entry.

Use the generated exact `queryKey(input)` or `metadataKey(input)` with native `getQueryData` and
`setQueryData`. Their data tags preserve the unselected query data type: selecting a name changes
the observer result, while a native write still supplies the complete user. A fresh native write
is visible to observers and subsequent imperative reads without another client execution.

Fetched metadata snapshots inherit QueryClient's global or prefix `structuralSharing` policy.
Selected metadata results and later manual writes use an explicit per-call `metadataOptions`
policy, or standard deep sharing if omitted. Initial, hydrated, manually written, and selected
objects remain application-owned. Decoded data is not deep-frozen. See
[Buffered metadata](/effect-api-query/reference/http-factory/#buffered-metadata) for that boundary.

## Keep defaults in native Query APIs

A per-operation defaults map would replace the repeated `setQueryDefaults(prefix, policy)` calls
with a map and a registration loop. These recipes need only prefix selection and native policy
merging, both already provided by TanStack. The map would add configuration without useful
behavior, so the package provides no defaults helper. Keep shared policies on QueryClient and
operation-specific selection, input, and typed error callbacks on the generated builders.
