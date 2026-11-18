---
title: Cache Keys and Filters
description: Read typed entries and target native cache operations with generated prefixes and exact keys.
---

Use a concrete generated key to read or write one typed cache entry. Use a root, branch, leaf, or view prefix to target multiple entries for invalidation or cancellation. Import `viewPrefix` from `@ueberbrot/effect-api-query` if you need one view. Add native conditions such as `stale` to narrow the match.

| Scope | Key | Matches |
| --- | --- | --- |
| Root | `rpc.key()` or `http.key()` | All cached query views in that utility tree |
| Branch | `rpc.users.key()` | Every descendant leaf and query view |
| Leaf | `rpc.users.get.key()` | Ordinary and infinite queries, plus metadata views for HTTP leaves |
| Operation | `viewPrefix(rpc.users.get, 'query')` | Ordinary queries for that leaf |
| Encoded partial input | Operation prefix followed by an encoded partial object | Entries containing those encoded fields |
| Exact entry | Generated concrete key with `exact: true` | One complete cache identity, including its stream policy |

The leaf prefix matches all its query views. Use `viewPrefix(leaf, 'streamed')` for accumulated history, `'live'` for the latest value, `'metadata'` for HTTP metadata, or `'infinite'` for pages. Mutation keys belong to a separate cache.

## Choose the cache operation

Invalidation marks matching queries stale and refetches active matches by default. Choose which reads a write affects.

RPC roots append `rpc` to the caller prefix. HTTP roots append `http` and the HttpApi identifier. The factories keep separate cache entries even when the caller prefix is the same. To match both, use the original caller prefix. To match one utility tree, use its generated root.

See [optimistic updates](/effect-api-query/guides/optimistic-writes/) to seed results or roll back local changes, and [refresh from events](/effect-api-query/guides/refresh-from-events/) to invalidate from delivered events. Use [cache owners](/effect-api-query/guides/switch-cache-owners/) for identity changes and [defaults and policies](/effect-api-query/guides/query-defaults/) to register defaults by prefix.

## Filter RPC queries

This example declares the same payload for unary `users.get` and streaming `users.watch`. Import `Effect` and `Schema` from `effect` in the contract module.

```ts
const payload = {
  id: Schema.FiniteFromString,
  locale: Schema.String.pipe(
    Schema.withConstructorDefault(Effect.succeed("en"))
  ),
};
```

Use the factory setup from the [RPC quick start](/effect-api-query/getting-started/quick-start/) to build `rpc`. Select every locale for user 1 with an encoded partial filter.

```ts
const queryPrefix = viewPrefix(rpc.users.get, "query");
await queryClient.invalidateQueries({
  queryKey: [...queryPrefix, { id: "1" }],
  type: "inactive",
  stale: false,
});
```

To match one request, keep its generated key and pass `exact: true`.

```ts
const queryKey = rpc.users.get.queryKey({ id: 1, locale: "en" });
const user = queryClient.getQueryData(queryKey);
await queryClient.invalidateQueries({ queryKey, exact: true });
```

Partial filters compare the encoded values stored in keys. Here `FiniteFromString` turns numeric input `1` into `"1"`, so filter by `id: "1"`. Omit `locale` to match every locale, or pass `locale: "en"` to match only English. Objects match recursively, arrays match by position, and strings must match in full.

Use the key builder for complete input. `queryKey({ id: 1 })` fills in the default locale. The builder rejects `{ locale: "en" }` because it lacks an ID. Use a partial filter to match across defaulted fields.

`[...viewPrefix(rpc.users.watch, 'streamed'), { id: '1' }]` matches every history policy for user 1. For one history, use `rpc.users.watch.streamedKey({ id: 1 }, { maxChunks: 2, refetchMode: 'append' })` with `exact: true`. Unbounded retention with reset keeps the unlimited-history key. Let the builder produce the stream suffix.

## Reuse a typed partial filter

Import `createQueryFilter` from `@ueberbrot/effect-api-query`. Bind the leaf and view once. Return the fields to match in their encoded shape.

```ts
const userQueries = createQueryFilter(rpc.users.get, "query", (id: number) => ({
  id: String(id),
}));
await queryClient.invalidateQueries(userQueries(1, { type: "inactive" }));
```

By default, the projection receives the leaf's full input type. Annotate its parameter to take a scalar or partial input. The example matches user 1 without supplying a locale. If the leaf uses a custom encoder, match that encoder's output. HTTP filters use the request labels and header names stored in the key.

To match the whole view, omit the projection. `createQueryFilter(rpc.users.get, 'query')` accepts native filter options. The builder copies and freezes its projected JSON. Invalid JSON or a failed projection throws before cache access. `exact: true` still requires a complete key. Bulk reads keep TanStack's heterogeneous result type.

## Filter HTTP queries

This example uses a contract with `id: Schema.FiniteFromString` in `params`, `query`, and `payload`, plus `'X-Locale': Schema.String` in `headers`. Its SSE endpoint `users.watch` declares `query: { id: Schema.FiniteFromString }`.

Build `http` using the [HTTP quick start](/effect-api-query/getting-started/http-quick-start/). Use request labels to select a path parameter or header independently.

```ts
const queryPrefix = viewPrefix(http.users.get, "query");
await queryClient.invalidateQueries({
  queryKey: [...queryPrefix, { params: { id: "1" } }],
});
await queryClient.invalidateQueries({
  queryKey: [...queryPrefix, { headers: { "x-locale": "en" } }],
});
```

For an exact read, pass the full decoded request to the builder.

```ts
const key = http.users.get.queryKey({
  params: { id: 1 },
  query: { id: 7 },
  headers: { "X-Locale": "en" },
  payload: { id: 7 },
});
const user = queryClient.getQueryData(key);
```

The leaf prefix also includes metadata and infinite views. For every history policy of a `users.watch` request, use `[...viewPrefix(http.users.watch, 'streamed'), { query: { id: '1' } }]`.

Default HTTP keys encode each request part, omit encoded `undefined` members, and lowercase headers. Use `params: { id: "1" }` to match the encoded number, and `headers: { 'x-locale': 'en' }` to match the header. Keep the labels in the filter. `{ query: { id: "7" } }` and `{ payload: { id: "7" } }` match different inputs. Unlabeled `{ id: "7" }` matches neither.

## Bound partial filters to the encoded shape

A custom encoder defines what the filter can match. If it returns `{ entity: { identifier: "1" }, language: "en" }`, use `{ entity: { identifier: "1" } }` with the operation prefix. A scalar such as `"1:en"` supports exact matching only at the payload position. HTTP custom encoders also control request labels and header names.

For partial matching, return a JSON object with all safe values that distinguish results. If the output shape changes, update persisted cache version busters. For opaque values, use a broad prefix or an exact generated key. A predicate can read values present in the key or app-owned query metadata.

Concrete keys carry a DataTag, which gives `getQueryData` and `setQueryData` their data types. View prefixes and hand-built keys lack this tag. Treat bulk results as `unknown` until you identify the data shape. A cast alone does not establish the type.

## Select a view across a branch

To invalidate ordinary reads while leaving live streams open, bind a branch filter.

```ts
import { createBranchQueryFilter } from "@ueberbrot/effect-api-query";

const userReads = createBranchQueryFilter(rpc.users, "query");
await queryClient.invalidateQueries(userReads());
```

Select `query`, `infinite`, `metadata`, `streamed`, or `live` on a generated root, branch, or leaf. The helper indexes supported descendants once. If the view is absent, the filter matches nothing. Your `predicate` and other native conditions further narrow matches. Use the result for filtering. For direct reads or defaults, use a key.
