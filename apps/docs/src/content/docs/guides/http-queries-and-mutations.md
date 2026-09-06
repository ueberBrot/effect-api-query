---
title: HTTP Queries and Mutations
description: Fetch and update data through an Effect HttpApi with TanStack Query.
---

Use `createHttpApiQueryUtils` with your HttpApi definition and ready HttpApiClient. The client
keeps its existing base URL, transport, and middleware configuration.

This example assumes your API has a `users` group with `get` and `create` endpoints. The `get`
endpoint declares a decoded numeric `id` in `params`; `create` accepts `{ name: string }` in
`payload`. Replace the application module imports with your own contract and client.

## Create the utilities

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { createHttpApiQueryUtils } from 'effect-api-query'

import { api } from './api.js'
import { client } from './http-client.js'

const queryClient = new QueryClient()
const http = createHttpApiQueryUtils(api, {
  client,
  keyPrefix: ['my-app'],
})
```

This client needs no additional execution services. If your client or its schemas require services,
also supply a `runPromiseExit` backed by your application runtime. Forward the runner's options
so [query cancellation](/effect-rpc-query/guides/cancellation/#cancel-an-http-query) reaches Effect.

## Fetch a user

```ts
const userOptions = http.users.get.queryOptions({
  input: { params: { id: 1 } },
  staleTime: 30_000,
})

const user = await queryClient.query(userOptions)
```

Pass decoded values in the endpoint's declared `params`, `query`, `headers`, and `payload`
containers. For example, a `Schema.FiniteFromString` parameter takes a number; the ready client
encodes it for transport. Include every declared container, even when its fields are optional.
An endpoint without request input uses `queryOptions()`.

React applications can pass `userOptions` directly to `useQuery`, `useSuspenseQuery`, or
`usePrefetchQuery`. A `select` callback receives decoded response data; it changes the observer's
data type without changing the cached value. `queryClient.getQueryData(userOptions.queryKey)`
still infers the decoded user type.

## Wait for request input

Use `skipToken` until the complete request is available:

```ts
import { useQuery } from '@tanstack/react-query'
import { skipToken } from 'effect-api-query'

const user = useQuery(
  http.users.get.queryOptions({
    input: userId === undefined ? skipToken : { params: { id: userId } },
    staleTime: 30_000,
    select: (user) => user.name,
  }),
)
```

`queryOptions(skipToken)` is shorthand when you need no other options. Skipping preserves caller
options and performs no request encoding or client call. Its query function is TanStack's exact
sentinel, so manual `refetch()` cannot execute it. Supply valid input to enable the query. Use
`enabled: false` with a complete request when you need a query that can run through manual refetch.
Suspense and prefetch-only hooks require executable options and reject skipped options. See
[Conditional Queries](/effect-rpc-query/guides/conditional-queries/) for the shared contract.

## Load pages

For an endpoint `users.list` with decoded query fields `cursor: number` and `filter: string`, and
a response `{ items: User[]; nextCursor: number | null }`, map each page parameter to a complete
request:

```ts
import { useInfiniteQuery } from '@tanstack/react-query'

const filter = 'active'
const pageOptions = http.users.list.infiniteOptions({
  initialPageParam: 0,
  input: (cursor) => ({ query: { cursor, filter } }),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
  select: (data) => data.pages.flatMap((page) => page.items),
})

const users = useInfiniteQuery(pageOptions)
```

`cursor` is inferred from `initialPageParam`. Return every declared request container from `input`,
including any `params`, `headers`, or `payload`; each page is a fresh decoded HTTP request.
Use `users.fetchNextPage()` when `users.hasNextPage` is true. The caller owns cursor progression:
return the server's next cursor from `getNextPageParam`, and return `undefined` or `null` when
there are no more pages.

The cache key uses `input(initialPageParam)` and an `infinite` discriminator. Keep all stable
filters in that initial request and in every later request. Rebuild the options when a filter
changes so the first request produces a different key. Keep `input` deterministic and free of
side effects: it runs during key construction and again for page execution. A custom key encoder
must preserve these same result-affecting filters.

TanStack owns page storage, invalidation, and refetching. `select` changes the hook result to the
flattened users; the cache still holds `pages` and `pageParams`. Every page retains ordinary HTTP
response normalization, wrapped failures, and cancellation. To pause pagination, use
`input: skipToken` with `initialPageParam` and `getNextPageParam`; the infinite builder accepts
only this object form for skipping.

## Create a user and refresh the cache

```ts
const createUser = new MutationObserver(
  queryClient,
  http.users.create.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: http.users.key() }),
  }),
)

await createUser.mutate({ payload: { name: 'Ada' } })
```

Mutation variables use the same decoded request shape as query input. Choose the invalidation
prefix for the data your write changes. React applications can pass the same mutation options to
`useMutation`.

Both builders return decoded response data. Successful `undefined` query data becomes `null`;
mutation results retain `undefined`. Inspect execution failures with
[`isEffectHttpApiQueryError`](/effect-rpc-query/guides/handle-failures/#inspect-http-failures).

## Keep cache entries separate

Use generated keys for individual queries or whole branches:

```ts
const key = http.users.get.queryKey({ params: { id: 1 } })
const cachedUser = queryClient.getQueryData(key)
await queryClient.invalidateQueries({ queryKey: http.users.key() })
```

If client middleware changes results by user or tenant, include a safe user or tenant identifier in
`keyPrefix`. Keep credentials out of keys. Use a
[custom encoder](/effect-rpc-query/guides/custom-key-encoders/#http-requests) when request schemas
need encoding services, contain redacted values, or allow multiple payload alternatives.

Retained HTTP endpoints expose ordinary query, infinite query, and mutation builders regardless
of HTTP method. Choose the builder for the operation you intend. Streaming responses and
multipart requests are omitted; see the [HTTP factory reference](/effect-rpc-query/reference/http-factory/)
for supported request formats and the complete builder contract.

When your application or server request ends, cancel its active queries and clear its QueryClient
before disposing client and runtime resources. See
[Client Lifecycle](/effect-rpc-query/concepts/client-lifecycle/#http-clients-and-execution-services).
