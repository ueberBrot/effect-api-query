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

In the application cache module, import `QueryClient` from `@tanstack/query-core`:

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 600_000, retry: false, retryDelay: 250 },
    mutations: { retry: false },
  },
})
```

After creating `rpc` with your ready client, register matching defaults:

```ts
queryClient.setQueryDefaults(rpc.key(), { staleTime: 60_000 })
queryClient.setQueryDefaults(rpc.users.key(), { retry: 2 })
queryClient.setQueryDefaults([...rpc.users.get.key(), 'query'], { staleTime: 120_000 })
```

In the query consumer, omit inherited settings or override them for this call:

```ts
const user = rpc.users.get.queryOptions({
  input: { id: 1 },
  select: (value) => value.name,
})
const refreshUser = rpc.users.get.queryOptions({
  input: { id: 1 },
  staleTime: 0,
  retry: false,
})
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

In the same application cache module, with an existing `http` tree:

```ts
queryClient.setQueryDefaults(http.key(), {
  queryKeyHashFn: (key) => `users:${JSON.stringify(key)}`,
})
queryClient.setQueryDefaults(http.users.key(), { retry: 1 })
queryClient.setQueryDefaults([...http.users.get.key(), 'metadata'], { staleTime: 5_000 })
```

In its query consumer:

```ts
const input = { params: { id: 1 } }
const user = http.users.get.queryOptions({ input })
const metadata = http.users.get.metadataOptions({ input })
```

The ordinary and metadata views have separate keys. Configure global or prefix `queryKeyHashFn`
on QueryClient before using the cache, and keep it stable for the cache owner's lifetime. Generated
options retain their own query function even if a prefix registers another one. Builders reject
per-call `queryHash` and `queryKeyHashFn` because native key-only reads and writes must resolve the
same entry.

Streams also reject a default `queryHash` that differs from the configured key hasher's result.
Changing hash defaults while matching entries remain cached can make stream execution reject
with `UnsupportedQueryHash`. Retire the old cache before changing its hash policy.

Use the generated exact `queryKey(input)` or `metadataKey(input)` with native `getQueryData` and
`setQueryData`. Their data tags preserve the unselected query data type: selecting a name changes
the observer result, while a native write still supplies the complete user. A fresh native write
is visible to observers and subsequent imperative reads without another client execution.

Fetched metadata follows native sharing defaults, while selected results and later manual writes
use explicit per-call policy or standard deep sharing. See
[Buffered metadata](/effect-api-query/reference/http-factory/#buffered-metadata) for immutable
snapshot and application-owned data rules.

An imperative `queryClient.query(newOptions)` hit on fresh cached data retains existing Query
options. Install a changed sharing policy through an observer or actual fetch before relying
on it for later manual writes.

Keep shared policies on QueryClient and operation-specific selection, input, and typed error
callbacks on the generated builders.
