---
title: Pagination
description: Map page parameters to typed RPC payloads and HTTP requests.
---

Use the utilities from the [RPC](/effect-api-query/getting-started/quick-start/) or [HTTP](/effect-api-query/getting-started/http-quick-start/) quick start. Here `users.page` takes a numeric `cursor` and `pageSize`. It returns `{ users, nextCursor }`, with `null` as the last page's cursor.

## Build page options

Convert each page parameter to RPC payload input.

```ts
const rpcPages = rpc.users.page.infiniteOptions({
  initialPageParam: 0,
  input: (cursor) => ({ cursor, pageSize: 20 }),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
});
const pages = await queryClient.infiniteQuery(rpcPages);
```

For HTTP, return all the endpoint's declared request objects from the mapper.

```ts
const httpPages = http.users.page.infiniteOptions({
  initialPageParam: 0,
  input: (cursor) => ({ query: { cursor, pageSize: 20 } }),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
});
```

Pass the options to your framework's infinite-query hook. Use `fetchNextPage` for the next page. Omit `input` if the operation takes none. If required input is missing, [pause the query](/effect-api-query/guides/conditional-queries/) with `input: skipToken`.

## Keep page identity stable

The first mapped request determines the key. Include the same filters on every page and rebuild options when filters change. The mapper runs for the key and again for execution. Given the same page parameter, it must return equivalent input.

The cache holds `pages` and `pageParams`. Use `select` to flatten the result returned to the caller. Cache reads still return the original page structure and inferred page-parameter type.

```ts
const cachedPages = queryClient.getQueryData(httpPages.queryKey);
```

Infinite and ordinary queries have distinct keys. Each page uses the query runner and abort signal. See [RPC options](/effect-api-query/reference/generated-builders/#build-an-infinite-query) and [HTTP options](/effect-api-query/reference/http-builders/#pagination).
