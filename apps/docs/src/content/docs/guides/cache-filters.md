---
title: Cache Keys and Filters
description: Read typed entries and target native cache operations with generated prefixes and exact keys.
---

For typed `getQueryData` and `setQueryData`, use a generated concrete key. For native `invalidateQueries`, `cancelQueries`, and query-state filters, use root, branch, leaf, or view prefixes. To select one supported cache view, import `viewPrefix` from `@ueberbrot/effect-api-query`. Choose the scope before adding `type`, `stale`, `fetchStatus`, or `predicate` conditions:

| Scope | Key | Matches |
| --- | --- | --- |
| Root | `rpc.key()` or `http.key()` | All cached query views in that utility tree |
| Branch | `rpc.users.key()` | Every descendant leaf and query view |
| Leaf | `rpc.users.get.key()` | Ordinary and infinite queries, plus metadata views for HTTP leaves |
| Operation | `viewPrefix(rpc.users.get, 'query')` | Ordinary queries for that leaf |
| Encoded partial input | Operation prefix followed by an encoded partial object | Entries containing those encoded fields |
| Exact entry | Generated concrete key with `exact: true` | One complete cache identity, including its stream policy |

A streaming leaf prefix includes accumulated and live views. Use `viewPrefix(leaf, 'streamed')` or `viewPrefix(leaf, 'live')` to select one representation. HTTP buffered metadata uses `metadata`. Pagination uses `infinite`. Mutation keys belong to TanStack's separate mutation cache, and query invalidation does not affect pending mutations.

## Choose the cache operation

Invalidation refreshes affected reads according to TanStack's native policy. It does not execute or cancel pending mutations. The application chooses which read keys a successful write affects.

RPC roots append `rpc` to the caller prefix. HTTP roots append `http` and the HttpApi identifier. The factories keep separate cache entries even when the caller prefix is the same. To match both, use the original caller prefix. To match one utility tree, use its generated root.

For response seeding and rollback, follow [Optimistic Updates](/effect-api-query/guides/optimistic-writes/). Map delivered domain events with [Refresh from Events](/effect-api-query/guides/refresh-from-events/). [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/) covers private data when users, tenants, sessions, or permissions change. [Defaults and Policies](/effect-api-query/guides/query-defaults/) uses the same prefixes to register native cache policy.

## Filter RPC queries

In these examples, unary `users.get` and streaming `users.watch` declarations share the same payload fields. In your contract module, import `Effect` and `Schema` from `effect`:

```ts
const payload = {
  id: Schema.FiniteFromString,
  locale: Schema.String.pipe(
    Schema.withConstructorDefault(Effect.succeed("en"))
  ),
};
```

Derive `rpc` from this group and its ready client using the factory setup in [RPC Quick Start](/effect-api-query/getting-started/quick-start/). In a cache callback, select every locale for user 1 with an encoded partial filter:

```ts
const queryPrefix = viewPrefix(rpc.users.get, "query");
await queryClient.invalidateQueries({
  queryKey: [...queryPrefix, { id: "1" }],
  type: "inactive",
  stale: false,
});
```

For one complete request, preserve its generated DataTag and use `exact: true`:

```ts
const queryKey = rpc.users.get.queryKey({ id: 1, locale: "en" });
const user = queryClient.getQueryData(queryKey);
await queryClient.invalidateQueries({ queryKey, exact: true });
```

Partial matching compares stored canonical key payloads. Here `FiniteFromString` encodes the numeric constructor input `1` as `"1"`, so the partial object must use `id: "1"`. A raw `id: 1` matches no entry. An omitted field places no constraint. Specifying `locale: "en"` selects that locale. Nested objects match recursively, arrays match by position, and scalar values must match exactly. A scalar string filter does not perform substring matching.

Use the concrete builder for complete constructor input. Calling `queryKey({ id: 1 })` materializes the default `locale: "en"`. That key cannot express every locale for user 1. Passing only `{ locale: "en" }` rejects the missing required `id`. Do not cast partial constructor input into a key builder or run it through the full payload constructor to derive a broad filter.

`[...viewPrefix(rpc.users.watch, 'streamed'), { id: '1' }]` stops before the stream-policy suffix. It matches every retention bound and refetch mode for that encoded user. For one history, use `rpc.users.watch.streamedKey({ id: 1 }, { maxChunks: 2, refetchMode: 'append' })` with `exact: true`. The omitted policy and explicit unlimited reset policy share the same normalized identity. Keep the remaining concrete suffix opaque. Root, branch, leaf, and operation filters survive policy changes.

## Reuse a typed partial filter

Import `createQueryFilter` from `@ueberbrot/effect-api-query` to bind the leaf and view once. Project only the fields you want to match, using their canonical encoded shape:

```ts
const userQueries = createQueryFilter(rpc.users.get, "query", (id: number) => ({
  id: String(id),
}));
await queryClient.invalidateQueries(userQueries(1, { type: "inactive" }));
```

An unannotated projection receives the leaf's full input type. Annotate its parameter to choose a scalar or partial application input, as above. It does not run the full input constructor, materialize omitted defaults, or invert a custom encoder. This filter selects every locale for user

1. With a custom key encoder, project into that encoder's shape. HTTP projections retain the request labels and normalized header names used by their keys.

Omit the projection to select the whole view: `createQueryFilter(rpc.users.get, 'query')` returns a builder accepting native filter conditions. Projected JSON is copied and frozen. Invalid JSON and projection failures throw during filter construction. These filters use native partial matching and ordinary keys; bulk reads retain native heterogeneous result types. Use a generated concrete key for typed exact cache access. `exact: true` on a partial filter still requires a complete matching key.

## Filter HTTP queries

HTTP filters retain labeled request containers. These filters assume your own `users.get` declares `id: Schema.FiniteFromString` in each of `params`, `query`, and `payload`, plus `'X-Locale': Schema.String` in `headers`. Its `users.watch` SSE endpoint declares `query: { id: Schema.FiniteFromString }`.

Derive `http` from that HttpApi and its ready client using the factory setup in [HTTP Quick Start](/effect-api-query/getting-started/http-quick-start/). In a cache callback, choose the path parameter or header independently:

```ts
const queryPrefix = viewPrefix(http.users.get, "query");
await queryClient.invalidateQueries({
  queryKey: [...queryPrefix, { params: { id: "1" } }],
});
await queryClient.invalidateQueries({
  queryKey: [...queryPrefix, { headers: { "x-locale": "en" } }],
});
```

For an exact read, supply the complete decoded request to the builder:

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

Default HTTP keys Schema-encode each request part, omit encoded `undefined` object members, and lowercase header names. In this contract, `params: { id: "1" }` is a meaningful partial object. The numeric value in `params: { id: 1 }` does not match. Filter `headers: { 'x-locale': 'en' }` even when the decoded request uses `'X-Locale'`. Preserve `params`, `query`, `headers`, and `payload`: `{ query: { id: "7" } }` and `{ payload: { id: "7" } }` select different requests. An unlabeled `{ id: "7" }` matches neither. HTTP request input does not use RPC payload construction.

## Bound partial filters to the encoded shape

A custom encoder replaces the default encoded shape. If it returns `{ entity: { identifier: "1" }, language: "en" }`, filter by `{ entity: { identifier: "1" } }` with the same operation prefix. `{ id: "1" }` no longer matches. If it returns the scalar `"1:en"`, native partial object matching cannot recover the original `id` or locale. HTTP custom encoders also replace request labels and header normalization.

Applications that need partial matching can define an explicit JSON object projection in their encoder and build filters against that projection. Preserve every safe value that distinguishes results. If the projection changes, update cache identity, including version busters for persisted caches. For opaque or noninvertible projections, use generated broad prefixes or a generated exact key. A custom predicate can inspect only information retained in the key or application-owned query metadata. It cannot reconstruct omitted input.

Concrete builders retain DataTags for typed `getQueryData` and `setQueryData`. `viewPrefix` returns an immutable ordinary key for supported leaf views. That key has no DataTag. Manually composed prefixes and partial keys carry no query-data tag. Native `getQueriesData` does not infer a homogeneous result from its filter. Keep broad reads as `unknown` until the application establishes the matched representation. An explicit generic or cast does not validate cached values.

## Select a view across a branch

To invalidate ordinary reads while keeping live streams open, bind a branch view filter:

```ts
import { createBranchQueryFilter } from "@ueberbrot/effect-api-query";

const userReads = createBranchQueryFilter(rpc.users, "query");
await queryClient.invalidateQueries(userReads());
```

The helper accepts a generated root, branch, or leaf and one of `query`, `infinite`, `metadata`, `streamed`, or `live`. It indexes supported descendant leaves once. A view absent from the branch matches nothing. Native conditions such as `stale`, `fetchStatus`, and `predicate` still apply; a supplied predicate is combined with the view match. The result is a native filter, not a query key for exact cache access or defaults. Bulk reads remain heterogeneous. Leave `exact` omitted for descendant matching.
