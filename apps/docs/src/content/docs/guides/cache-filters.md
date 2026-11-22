---
title: Cache Keys and Filters
description: Read typed entries and target native cache operations with generated prefixes and exact keys.
---

Use a concrete generated key to read or write one typed cache entry. Pass a generated `.queryFilter()` to cache operations such as `invalidateQueries` and `cancelQueries`. Add native conditions such as `stale` to narrow the match.

| Scope | Filter | Matches |
| --- | --- | --- |
| Root | `rpc.queryFilter()` or `http.queryFilter()` | All query views in that utility tree |
| Branch | `rpc.users.queryFilter()` | Every descendant query view |
| Leaf | `rpc.users.get.queryFilter()` | Every query view of one leaf |
| View | `rpc.users.get.queryFilter({ view: "query" })` | All inputs of one leaf's query view |
| Input | `rpc.users.get.queryFilter({ view: "query", input: { id: 1 } })` | Queries with that canonical input |
| Exact entry | `{ queryKey, exact: true }` with a concrete key | One complete cache identity, including its stream policy |

Select `streamed` for accumulated history, `live` for the latest value, `metadata` for HTTP metadata, or `infinite` for pages. Mutation keys belong to a separate cache. Multipart HTTP leaves provide mutation builders only.

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
const queryPrefix = rpc.users.get.queryFilter({ view: "query" }).queryKey;
await queryClient.invalidateQueries({
  queryKey: [...queryPrefix, { id: "1" }],
  type: "inactive",
  stale: false,
});
```

To match one request, keep its generated key and pass `exact: true`.

```ts
const queryKey = rpc.users.get.queryKey({ input: { id: 1, locale: "en" } });
const user = queryClient.getQueryData(queryKey);
await queryClient.invalidateQueries({ queryKey, exact: true });
```

Partial filters compare the encoded values stored in keys. Here `FiniteFromString` turns numeric input `1` into `"1"`, so filter by `id: "1"`. Omit `locale` to match every locale, or pass `locale: "en"` to match only English. Objects match recursively, arrays match by position, and strings must match in full.

Use the key builder for complete input. `queryKey({ input: { id: 1 } })` fills in the default locale. The builder rejects `{ input: { locale: "en" } }` because the input lacks an ID. Use a partial filter to match across defaulted fields.

Pass a full input or a `PreparedInput` with the view to use the leaf's key encoding. A stream filter matches every stream policy for that input.

```ts
const input = { id: 1, locale: "en" };
await queryClient.cancelQueries(
  rpc.users.watch.queryFilter({ view: "streamed", input })
);

const queryKey = rpc.users.watch.streamedKey({
  input,
  maxChunks: 2,
  refetchMode: "append",
});
await queryClient.cancelQueries({ queryKey, exact: true });
```

## Reuse a typed partial filter

Import `createQueryFilter` from `@ueberbrot/effect-api-query`. Bind the leaf and view once. Return the fields to match in their encoded shape.

```ts
const userQueries = createQueryFilter(rpc.users.get, "query", (id: number) => ({
  id: String(id),
}));
await queryClient.invalidateQueries(userQueries(1, { type: "inactive" }));
```

By default, the projection receives the leaf's full input type. Annotate its parameter to take a scalar or partial input. The example matches user 1 without supplying a locale. If the leaf uses a custom encoder, match that encoder's output. HTTP filters use the request labels and header names stored in the key.

Use `rpc.users.get.queryFilter({ view: "query" })` to match the whole view. The projection builder copies and freezes its projected JSON. Invalid JSON or a failed projection throws before cache access. `exact: true` still requires a complete key. Bulk reads keep TanStack's heterogeneous result type.

## Filter HTTP queries

This example uses a contract with `id: Schema.FiniteFromString` in `params`, `query`, and `payload`, plus `'X-Locale': Schema.String` in `headers`. Its SSE endpoint `users.watch` declares `query: { id: Schema.FiniteFromString }`.

Build `http` using the [HTTP quick start](/effect-api-query/getting-started/http-quick-start/). Use request labels to select a path parameter or header independently.

```ts
const queryPrefix = http.users.get.queryFilter({ view: "query" }).queryKey;
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
  input: {
    params: { id: 1 },
    query: { id: 7 },
    headers: { "X-Locale": "en" },
    payload: { id: 7 },
  },
});
const user = queryClient.getQueryData(key);
```

The leaf prefix also includes metadata and infinite views. To match all history policies for one request, use `http.users.watch.queryFilter({ view: "streamed", input: { query: { id: 1 } } })`.

Default HTTP keys encode each request part, omit encoded `undefined` members, and lowercase headers. Use `params: { id: "1" }` to match the encoded number, and `headers: { 'x-locale': 'en' }` to match the header. Keep the labels in the filter. `{ query: { id: "7" } }` and `{ payload: { id: "7" } }` match different inputs. Unlabeled `{ id: "7" }` matches neither.

## Bound partial filters to the encoded shape

A custom encoder defines what the filter can match. If it returns `{ entity: { identifier: "1" }, language: "en" }`, use `{ entity: { identifier: "1" } }` with the operation prefix. A scalar such as `"1:en"` supports exact matching only at the payload position. HTTP custom encoders also control request labels and header names.

For partial matching, return a JSON object with all safe values that distinguish results. If the output shape changes, update persisted cache version busters. For opaque values, use a broad prefix or an exact generated key. A predicate can read values present in the key or app-owned query metadata.

Concrete keys carry a DataTag, which gives `getQueryData` and `setQueryData` their data types. View prefixes and hand-built keys lack this tag. Treat bulk results as `unknown` until you identify the data shape. A cast alone does not establish the type.

## Select a view across a branch

To invalidate ordinary reads and leave live streams open, select the `query` view on a branch.

```ts
await queryClient.invalidateQueries(rpc.users.queryFilter({ view: "query" }));
```

The filter checks descendant paths without constructing their leaves. If no descendant supports the view, the filter matches nothing. A custom `predicate` narrows the match further. Leave out `exact` to include descendants. Use `viewPrefix(leaf, view)` when you need a raw key prefix, such as for `setQueryDefaults`.
