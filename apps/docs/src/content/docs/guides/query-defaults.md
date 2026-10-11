---
title: Defaults and Policies
description: Reuse native cache defaults and typed query or mutation policies.
---

Choose where to define each setting before reusing it across generated builders:

| Scope                    | Use                                         | Suitable settings                                               |
| ------------------------ | ------------------------------------------- | --------------------------------------------------------------- |
| Cache owner or namespace | QueryClient defaults and generated prefixes | Common freshness, retry, garbage collection, and hashing        |
| One leaf and query view  | `withQueryPolicy`                           | Freshness and typed data and error callbacks                    |
| One mutation leaf        | `withMutationPolicy`                        | Typed invalidation and other mutation callbacks                 |
| One call                 | The options builder                         | Input, selection, initial data, pagination, and local overrides |

Use your existing utility tree and application-owned QueryClient. Policies preserve the original
builder's inference. The library supplies the generated keys and execution functions.

## Register native defaults

In the cache module, import `QueryClient` from `@tanstack/query-core` and `viewPrefix` from
`effect-api-query`:

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 600_000, retry: false, retryDelay: 250 },
    mutations: { retry: false },
  },
})
```

After creating `rpc` with its ready client, register broader prefixes before narrower prefixes:

```ts
queryClient.setQueryDefaults(rpc.key(), { staleTime: 60_000 })
queryClient.setQueryDefaults(rpc.users.key(), { retry: 2 })
queryClient.setQueryDefaults(viewPrefix(rpc.users.get, 'query'), { staleTime: 120_000 })
```

TanStack merges global defaults, matching registered prefixes in registration order, and explicit
builder options. It does not sort prefixes by specificity. Here, `users.get` inherits
`gcTime: 600_000`, `retry: 2`, and `staleTime: 120_000`. Two retries allow at most three executions.

`rpc.key()` covers the tree, `rpc.users.key()` covers its branch, and the view prefix covers only
ordinary queries of that leaf, for every input. HTTP uses the same native APIs:

```ts
queryClient.setQueryDefaults(http.users.key(), { retry: 1 })
queryClient.setQueryDefaults(viewPrefix(http.users.get, 'metadata'), { staleTime: 5_000 })
```

This five-second policy applies to metadata without changing the ordinary view's freshness.
Register mutation defaults separately with native `setMutationDefaults` and `mutationKey()`.
See [Cache Keys and Filters](/effect-api-query/guides/cache-filters/) for prefix scopes.

Before using the cache, configure hashing through QueryClient defaults. Keep hashing stable for
the cache owner's lifetime. Builders reject per-call hashing overrides. See
[Semantic Keys](/effect-api-query/concepts/semantic-keys/) for the identity contract.

## Bind a reusable query policy

If a policy belongs to one leaf and view, use `withQueryPolicy`. `QueryPolicy` types reusable
objects with that leaf's native options. Retry and refetch callbacks retain its data and error types.
Import both from `effect-api-query`:

```ts
const policy = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: false,
} satisfies QueryPolicy<typeof rpc.users.get>
const userOptions = withQueryPolicy(rpc.users.get, 'query', policy)
const user = userOptions({ input: { id: 1 }, select: (value) => value.name })
const refreshUser = userOptions({ input: { id: 1 }, staleTime: 0, retry: false })
```

The returned builder keeps selected-data, defined-initial-data, skipped-input, and page-parameter
inference. `QueryPolicy<Leaf, View>` supports only that leaf's query views: `query`, `infinite`,
`metadata`, `live`, or `streamed`. Specify the view in the type when it is not `query`.
See [Type Inference](/effect-api-query/reference/type-inference/) for cache and failure types, and
[Retry Queries](/effect-api-query/guides/retry-queries/) for reusable domain-aware decisions.

Policies accept applicable native freshness, retry, refetch, and cache settings. Keep input,
`select`, initial and placeholder data, page parameters and mappers, and adapter controls at the
call site. Stream retention and decoder policies determine cache identity and also stay local.

A bound policy supplies explicit builder options, so it overrides QueryClient defaults. Call-site
options override the bound policy. To inherit a field, omit it. To replace an inherited setting,
use a value such as `staleTime: 0` or `retry: false`.

## Bind mutation invalidation

Import `withMutationPolicy` from `effect-api-query`. Seed the returned user and invalidate affected
reads once for every use of the creation builder:

```ts
const createUserOptions = withMutationPolicy(rpc.users.create, {
  onSuccess: async (created) => {
    queryClient.setQueryData(rpc.users.get.queryKey({ id: created.id }), created)
    await queryClient.invalidateQueries({ queryKey: rpc.users.key() })
  },
})
```

Shared callbacks infer data, variables, and execution errors. `MutationPolicy<Leaf>` can annotate a
reusable object. Its optimistic result is `unknown`. To infer that result in local callbacks,
supply `onMutate` at each call site. Here, `reportCreationFailure` notifies the application of a failure:

```ts
const createUser = createUserOptions({
  onMutate: (variables) => ({ submittedName: variables.name }),
  onError: (error, _variables, context) => {
    reportCreationFailure(context?.submittedName, error)
  },
})
```

A call-site callback replaces the corresponding shared callback. Compose callbacks explicitly
when both must run. The [complete example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-policies.ts)
includes ready-client types and the imports used here.
