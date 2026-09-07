---
title: Cache Management
description: Invalidate and inspect caches with generated prefix keys.
---

Every branch and leaf exposes `key()`. Use these prefix-matchable keys for cache-wide operations:

```ts
await queryClient.invalidateQueries({ queryKey: rpcQuery.users.key() })
await queryClient.invalidateQueries({ queryKey: rpcQuery.users.get.key() })
```

Use `queryKey(input)` for one payload-specific query:

```ts
const input = { id: 1 }
const key = rpcQuery.users.get.queryKey(input)

const cachedUser = queryClient.getQueryData(key)
await queryClient.invalidateQueries({ queryKey: key, exact: true })
```

Query keys have this flat shape:

```ts
;[
  ...keyPrefix,
  'rpc',
  ...rpcTagSegments,
  'query',
  canonicalPayload, // payload-bearing queries only
]
```

Mutation keys end in `'mutation'` and never include variables. See
[Semantic Keys](/effect-api-query/concepts/semantic-keys/) for normalization and hashing rules.

## Manage HTTP caches

HTTP utilities expose the same branch-prefix and ordinary-query key builders. Supply the endpoint's
decoded request input for a specific entry:

```ts
const key = http.users.get.queryKey({ params: { id: 1 } })
const cachedUser = queryClient.getQueryData(key)
await queryClient.invalidateQueries({ queryKey: http.users.key() })
```

HTTP keys include `'http'` and the HttpApi identifier after your `keyPrefix`. RPC keys include
`'rpc'`, so the two factories keep separate caches even with the same caller prefix. Use the original
caller prefix when you deliberately want to invalidate both.

The [packed RPC consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/packed-consumer/runtime.mts) and
[packed HTTP consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/packed-consumer/http-runtime.mts) exercise generated keys through QueryClient.
