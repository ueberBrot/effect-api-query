---
title: Queries
description: Build typed query options for cached RPC and HTTP reads.
---

Use the ready utility tree and QueryClient from the [RPC quick start](/effect-api-query/getting-started/quick-start/) or [HTTP quick start](/effect-api-query/getting-started/http-quick-start/). In this example, `users.get` returns a user with `id` and `name`. Its RPC payload has an `id` and default locale. The HTTP endpoint declares `params.id` and `query.locale`.

## Fetch decoded data

Pass RPC payload constructor input to `queryOptions`:

```ts
const userOptions = rpc.users.get.queryOptions({
  input: { id: 1 },
  staleTime: 30_000,
});
const user = await queryClient.query(userOptions);
```

HTTP options take the complete decoded request. Include every declared container:

```ts
const httpUserOptions = http.users.get.queryOptions({
  input: { params: { id: 1 }, query: { locale: "en" } },
  staleTime: 30_000,
});
const httpUser = await queryClient.query(httpUserOptions);
```

These options also work with native query, suspense, and prefetch hooks. An inputless operation uses `queryOptions()`. Queries cache decoded success and convert top-level `undefined` to `null`. Keep captured input values unchanged while using the options.

## Select returned data

Pass native options such as `staleTime`, `retry`, and `select` to the builder:

```ts
const nameOptions = rpc.users.get.queryOptions({
  input: { id: 1 },
  select: (user) => user.name,
});
const selectedName = await queryClient.query(nameOptions);
const cachedUser = queryClient.getQueryData(nameOptions.queryKey);
```

Hooks, observers, and `queryClient.query` return the selected name. The cache and `getQueryData` retain the decoded user. Generated keys preserve that type. Builders supply `queryKey` and `queryFn`. Configure hashing through [QueryClient defaults](/effect-api-query/guides/query-defaults/).

Continue with [Conditional Queries](/effect-api-query/guides/conditional-queries/), [Cache Keys and Filters](/effect-api-query/guides/cache-filters/), or your framework's integration guide.
