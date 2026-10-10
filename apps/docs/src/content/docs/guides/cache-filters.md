---
title: Cache Filters
description: Compose native filters for operations, encoded partial inputs, and exact cache entries.
---

Pass generated prefixes or concrete keys to TanStack's native filters. Choose the scope before
adding `type`, `stale`, `fetchStatus`, or `predicate` conditions:

| Scope                 | Key                                                    | Matches                                                                |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Root                  | `rpc.key()` or `http.key()`                            | All cached query views in that utility tree                            |
| Branch                | `rpc.users.key()`                                      | Every descendant leaf and query view                                   |
| Leaf                  | `rpc.users.get.key()`                                  | Ordinary and infinite queries; HTTP leaves also include metadata views |
| Operation             | `[...rpc.users.get.key(), 'query']`                    | Ordinary queries for that leaf                                         |
| Encoded partial input | Operation prefix followed by an encoded partial object | Entries containing those encoded fields                                |
| Exact entry           | Generated concrete key with `exact: true`              | One complete cache identity, including its stream policy               |

A streaming leaf prefix includes accumulated and live views. Append `streamed` or `live` to select
one representation. HTTP buffered metadata uses `metadata`; pagination uses `infinite`.
Mutation keys belong to TanStack's separate mutation cache, and query invalidation does not affect
pending mutations.

## Filter RPC queries

This recipe accepts an application-owned ready client. Its `forId` filter matches every locale for
one user, while `exact` retains the generated DataTag for one complete payload:

```ts
import { Effect, Schema } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcClient, RpcGroup } from 'effect/rpc'

const User = Schema.Struct({ id: Schema.Finite, name: Schema.String })
const payload = {
  id: Schema.FiniteFromString,
  locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))),
}
export const usersRpc = RpcGroup.make(
  Rpc.make('users.get', { payload, success: User }),
  Rpc.make('users.watch', { payload, success: User, stream: true }),
  Rpc.make('users.list', { success: Schema.Array(User) }),
  Rpc.make('health.ping', { success: Schema.String }),
)

export const userCacheFilters = <ClientError>(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof usersRpc>, ClientError>,
) => {
  const rpc = createRpcQueryUtils<typeof usersRpc, readonly ['users-app'], ClientError>(usersRpc, {
    client,
    keyPrefix: ['users-app'],
  })
  const queryPrefix = [...rpc.users.get.key(), 'query'] as const
  const historyPrefix = [...rpc.users.watch.key(), 'streamed'] as const

  return {
    rpc,
    root: { queryKey: rpc.key() },
    branch: { queryKey: rpc.users.key() },
    leaf: { queryKey: rpc.users.get.key() },
    query: { queryKey: queryPrefix },
    forId: (id: number) => ({ queryKey: [...queryPrefix, { id: String(id) }] as const }),
    history: { queryKey: historyPrefix },
    historyForId: (id: number) => ({
      queryKey: [...historyPrefix, { id: String(id) }] as const,
    }),
    exact: (id: number, locale = 'en') => ({
      queryKey: rpc.users.get.queryKey({ id, locale }),
      exact: true as const,
    }),
  }
}
```

Create the filters with `userCacheFilters(client)`, then pass a filter to
`queryClient.invalidateQueries(filters.forId(1))`. Combine native conditions by spreading the filter,
for example `{ ...filters.forId(1), type: 'inactive', stale: false }`. Use
`queryClient.getQueryData(filters.exact(1).queryKey)` for a typed user read.

Partial matching compares stored canonical key payloads. Here `FiniteFromString` encodes the numeric
constructor input `1` as `"1"`, so the partial object must use `id: "1"`. A raw `id: 1` matches no
entry. An omitted field places no constraint; specifying `locale: "en"` selects that locale.
Nested objects match recursively, arrays match by position, and scalar values must match exactly.
A scalar string filter does not perform substring matching.

Use the concrete builder for complete constructor input. Calling `queryKey({ id: 1 })` materializes
the default `locale: "en"`; its key therefore cannot express every locale for user 1. Passing only
`{ locale: "en" }` rejects the missing required `id`. Do not cast partial constructor input into a
key builder or run it through the full payload constructor to derive a broad filter.

`historyForId(1)` stops before the stream-policy suffix and matches every retention bound and
refetch mode for that encoded user. For one history, use
`rpc.users.watch.streamedKey({ id: 1 }, { maxChunks: 2, refetchMode: 'append' })` with `exact: true`.
The omitted policy and explicit unlimited/reset policy share the same normalized identity. Keep the
remaining concrete suffix opaque; root, branch, leaf, and operation filters survive policy changes.

## Filter HTTP queries

HTTP partial objects retain their labelled request containers. This recipe selects a path parameter
or normalized header without constraining the query or payload:

```ts
import { Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api'

export const usersApi = HttpApi.make('users-api').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.post('get', '/users/:id', {
      params: { id: Schema.FiniteFromString },
      query: { id: Schema.FiniteFromString, filter: Schema.optional(Schema.String) },
      headers: Schema.Record(Schema.String, Schema.optional(Schema.String)),
      payload: Schema.Struct({ id: Schema.FiniteFromString }),
      success: Schema.String,
    }),
    HttpApiEndpoint.get('watch', '/users/events', {
      query: { id: Schema.FiniteFromString },
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
    }),
  ),
  HttpApiGroup.make('system', { topLevel: true }).add(
    HttpApiEndpoint.get('ping', '/health', { success: Schema.String }),
  ),
)

export const httpCacheFilters = (client: HttpApiClient.ForApi<typeof usersApi>) => {
  const http = createHttpApiQueryUtils(usersApi, { client, keyPrefix: ['users-app'] })
  const queryPrefix = [...http.users.get.key(), 'query'] as const

  return {
    http,
    root: { queryKey: http.key() },
    branch: { queryKey: http.users.key() },
    leaf: { queryKey: http.users.get.key() },
    query: { queryKey: queryPrefix },
    forId: (id: number) => ({
      queryKey: [...queryPrefix, { params: { id: String(id) } }] as const,
    }),
    forLocale: (locale: string) => ({
      queryKey: [...queryPrefix, { headers: { 'x-locale': locale } }] as const,
    }),
    historyForId: (id: number) => ({
      queryKey: [...http.users.watch.key(), 'streamed', { query: { id: String(id) } }] as const,
    }),
    exact: (input: Parameters<typeof http.users.get.queryKey>[0]) => ({
      queryKey: http.users.get.queryKey(input),
      exact: true as const,
    }),
  }
}
```

Pass `httpCacheFilters(client).forId(1)` to `invalidateQueries` to refresh ordinary queries for path
parameter 1. Use the leaf filter to include infinite and metadata views too. `historyForId(1)`
selects every accumulated retention policy for the SSE request with query parameter 1.

Default HTTP keys Schema-encode each request part, omit encoded `undefined` object members, and
lowercase header names. In this contract, `params: { id: "1" }` is a meaningful partial object;
`params: { id: 1 }` is not. Filter `headers: { 'x-locale': 'en' }` even when the decoded request uses
`'X-Locale'`. Preserve `params`, `query`, `headers`, and `payload`: `{ query: { id: "7" } }` and
`{ payload: { id: "7" } }` select different requests. An unlabelled `{ id: "7" }` matches neither.
HTTP request input does not use RPC payload construction.

## Bound partial filters to the encoded shape

A custom encoder replaces the default encoded shape. If it returns
`{ entity: { identifier: "1" }, language: "en" }`, filter by
`{ entity: { identifier: "1" } }`, using the same operation prefix. `{ id: "1" }` no longer matches.
If it returns the scalar `"1:en"`, native partial object matching cannot recover the original `id` or
locale. HTTP custom encoders also replace request labels and header normalization.

Applications that need partial matching can define an explicit JSON object projection in their
encoder and build filters against that projection. Preserve every safe value that distinguishes
results. Treat projection changes as cache-identity changes, including persisted-cache version
busters. For opaque or noninvertible projections, use generated broad prefixes or a generated exact
key. A custom predicate can inspect only the information retained in the key or other
application-owned query metadata; it cannot reconstruct omitted input.

The package keeps filter composition native. A generic partial-constructor helper cannot promise
meaningful matching across defaults, Schema transformations, and arbitrary encoder output. The
small operation-prefix expressions already compose with every native condition, so an additional
public helper would add no proven capability. This preserves the
[filter-composition decision](https://github.com/ueberBrot/effect-api-query/blob/main/docs/adr/0008-use-flat-prefix-matchable-key-tuples.md).

Concrete builders retain DataTags for typed `getQueryData` and `setQueryData`. Manually composed
prefixes and partial keys carry no query-data tag, and native `getQueriesData` does not infer a
homogeneous result from its filter. Keep broad reads as `unknown` until the application establishes
the matched representation; an explicit generic or cast does not validate cached values.
