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
[Semantic Keys](/effect-rpc-query/concepts/semantic-keys/) for normalization and hashing rules.
