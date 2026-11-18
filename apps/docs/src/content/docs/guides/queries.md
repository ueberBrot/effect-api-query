---
title: Queries
description: Build typed query options for cached RPC and HTTP reads.
---

Fetch and cache a user with the utilities from the [RPC quick start](/effect-api-query/getting-started/quick-start/) or [HTTP quick start](/effect-api-query/getting-started/http-quick-start/). Both examples return a user with an `id` and `name`.

## Fetch decoded data

Pass the RPC payload to `queryOptions`. The Schema supplies the default locale.

```ts
const userOptions = rpc.users.get.queryOptions({
  input: { id: 1 },
  staleTime: 30_000,
});
const user = await queryClient.query(userOptions);
```

For HTTP, include the declared request objects. This endpoint takes `params.id` and `query.locale`.

```ts
const httpUserOptions = http.users.get.queryOptions({
  input: { params: { id: 1 }, query: { locale: "en" } },
  staleTime: 30_000,
});
const httpUser = await queryClient.query(httpUserOptions);
```

You can pass these options to native query, Suspense, and prefetch hooks. Call `queryOptions()` for an operation with no input. Queries cache decoded data and convert a top-level `undefined` to `null`. Keep the input unchanged while the options can run.

## Select returned data

Pass native Query options such as `staleTime`, `retry`, and `select` to the builder.

```ts
const nameOptions = rpc.users.get.queryOptions({
  input: { id: 1 },
  select: (user) => user.name,
});
const selectedName = await queryClient.query(nameOptions);
const cachedUser = queryClient.getQueryData(nameOptions.queryKey);
```

The hook, observer, or `queryClient.query` returns the selected name. The cache still holds the full user, so `getQueryData(nameOptions.queryKey)` returns the user. The builder supplies `queryKey` and `queryFn`. Set hashing through [QueryClient defaults](/effect-api-query/guides/query-defaults/).

If you lack required input, see [pause a query](/effect-api-query/guides/conditional-queries/). To read the cache directly, see [cache keys and filters](/effect-api-query/guides/cache-filters/).
