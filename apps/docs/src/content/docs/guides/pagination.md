---
title: Pagination
description: Map page parameters to typed RPC payloads and HTTP requests.
---

Use a ready [RPC](/effect-api-query/getting-started/quick-start/) or [HTTP](/effect-api-query/getting-started/http-quick-start/) utility tree. In these examples, `users.page` accepts numeric `cursor` and `pageSize` fields and returns `{ users, nextCursor }`, with `null` marking the last page.

## Build page options

Map each page parameter to RPC payload constructor input:

```ts
const rpcPages = rpc.users.page.infiniteOptions({
  initialPageParam: 0,
  input: (cursor) => ({ cursor, pageSize: 20 }),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
});
const pages = await queryClient.infiniteQuery(rpcPages);
```

For HTTP, return every declared request container from the mapper:

```ts
const httpPages = http.users.page.infiniteOptions({
  initialPageParam: 0,
  input: (cursor) => ({ query: { cursor, pageSize: 20 } }),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
});
```

Pass these options to the native infinite-query hook to load further pages with `fetchNextPage`. Inputless operations omit `input`. Input-bearing operations can pause with `input: skipToken`. See [Conditional Queries](/effect-api-query/guides/conditional-queries/).

## Keep page identity stable

The mapped initial request determines cache identity. Include filters in that request and every page. When filters change, rebuild the options. The mapper runs during key construction and page execution, so keep it deterministic.

TanStack stores `pages` and `pageParams`. A native `select` can flatten returned data. Cache reads retain the original pages and inferred page-parameter type:

```ts
const cachedPages = queryClient.getQueryData(httpPages.queryKey);
```

Infinite views have separate keys from ordinary queries. Every page uses the query runner and abort signal. See [RPC Builders](/effect-api-query/reference/generated-builders/#build-an-infinite-query) and [HTTP Builders](/effect-api-query/reference/http-builders/#pagination) for exact option contracts.
