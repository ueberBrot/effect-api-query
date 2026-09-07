---
title: TanStack Start
description: Share generated query options across loaders, SSR, and React components.
---

Use this guide to connect an existing Effect contract to Start loaders and React Query hooks.
The runnable example serves both RPC and HTTP from one Start process.

## Host Effect RPC in Start

Create an exact server route and pass its Web `Request` to a long-lived Effect RPC handler:

```ts
export const Route = createFileRoute('/rpc')({
  server: {
    handlers: {
      POST: ({ request }) => handleApiRequest(request),
    },
  },
})
```

Effect's request/response RPC transport sends every query and mutation to this POST endpoint. It
does not map queries to GET requests or encode procedure names in the URL. Build the handler once
for the Start server's lifetime so RPC state and acquired resources survive individual requests.

Configure a trusted application origin for server rendering. In the executable example, set the server-only
`EXAMPLE_API_ORIGIN` environment variable; it defaults to `http://127.0.0.1:3000`. Use the relative
`/rpc` endpoint for browser calls.

## Host an Effect HTTP API alongside RPC

Mount the shared HTTP contract at `/api/$` and forward each endpoint's declared method to the
long-lived HTTP handler. Keep the exact `/rpc` route for RPC requests. In the example, both handlers
share the user directory, while each transport retains its own generated query keys.

```ts
export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleApiRequest(request),
      POST: ({ request }) => handleApiRequest(request),
      DELETE: ({ request }) => handleApiRequest(request),
    },
  },
})
```

The example uses the trusted `EXAMPLE_API_ORIGIN` for server calls to both `/rpc` and `/api`.
Browser calls use same-origin paths. Keep the server destination in trusted configuration so
incoming `Host` and forwarded headers cannot redirect server-side requests.

Create a ready `HttpApiClient` with the request's authentication context, then pass it to
`createHttpApiQueryUtils`. Add the resulting `httpQuery` tree to the same router context as
`queryClient` and `rpcQuery`. See [HTTP queries and mutations](/effect-rpc-query/guides/http-queries-and-mutations/)
for the factory and request containers.

## Share utilities through the router context

Put the application-owned `QueryClient` and generated utility trees in the router context. A route loader
can then fill the cache used by its component:

```tsx
export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    await context.queryClient.query({
      ...context.rpcQuery.users.list.queryOptions(),
      staleTime: 'static',
    })
  },
  component: UsersRoute,
})

function UsersRoute() {
  const { rpcQuery } = Route.useRouteContext()
  const users = useSuspenseQuery(rpcQuery.users.list.queryOptions())
  return <pre>{JSON.stringify(users.data, null, 2)}</pre>
}
```

For HTTP, prefetch the directory and first page in the loader. Use the same builders in the
component so the browser reads the hydrated entries:

```tsx
import type { TanStackStartApplication } from '../lib/application.ts'

const userPagesOptions = (httpQuery: TanStackStartApplication['httpQuery']) =>
  httpQuery.users.page.infiniteOptions({
    initialPageParam: 0,
    input: (cursor: number) => ({ query: { cursor, pageSize: 4 } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })

export const Route = createFileRoute('/http')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.query(context.httpQuery.users.list.queryOptions()),
      context.queryClient.infiniteQuery(userPagesOptions(context.httpQuery)),
    ]),
  component: HttpUsersRoute,
})

function HttpUsersRoute() {
  const { httpQuery } = Route.useRouteContext()
  const users = useSuspenseQuery(httpQuery.users.list.queryOptions())
  const pages = useInfiniteQuery(userPagesOptions(httpQuery))
  return (
    <>
      <pre>{JSON.stringify(users.data, null, 2)}</pre>
      <button disabled={!pages.hasNextPage} onClick={() => void pages.fetchNextPage()}>
        Load next page
      </button>
    </>
  )
}
```

Set a suitable `staleTime` on the Query Client or generated options. The example keeps successful
data fresh for 60 seconds, allowing hydration and navigation to reuse it without duplicate reads.
Use generated mutations and group keys to invalidate the relevant cache after a write. When both
transports expose the same data, invalidate both utility groups.

## Preserve application lifetimes

Create a fresh Query Client, ready clients, runners, and utility trees for each server-rendered
page request. Keep authentication context in that request's clients and use a safe identity partition
in the key prefix when identity affects results. Dehydrate that request's Query Client, send
its state to the browser, and hydrate a browser-owned Query Client. Reusing the same generated
options preserves cache identity. RPC keys include the RPC tag, operation, and canonical payload;
HTTP keys include the API identifier, group, endpoint, operation, and encoded request parts. Both
include the application key prefix.

`effect-api-query` does not create the router, providers, request context, or hydration boundary.
The executable [TanStack Start example](https://github.com/ueberBrot/effect-rpc-query/tree/main/examples/tanstack-start)
shows the complete integration, including handler cleanup for server-route requests and hot module
replacement. Cancel outstanding queries and dispose the request's runtime when SSR finishes or
the request aborts. The browser owns a separate runtime for its application lifetime.

The example's authorization header is a public demonstration value. The ownership fixture creates
separate authorized and anonymous clients and verifies their cache and disposal isolation; replace
that value with your application's request authentication when adapting the example.

The Vite preview configuration disables compression for `/api/` and `/rpc`. Its current compression
middleware delays response-close listeners until the first write, preventing a pending buffered
request from observing a disconnect. The browser acceptance test verifies both the aborted request
and the server's interruption count. Production hosts must likewise propagate disconnects to the
Web `Request` signal.

## Omit failed queries from dehydration

Keep TanStack's `defaultShouldDehydrateQuery` policy. It dehydrates successful data and omits failed
queries, so `EffectHttpApiQueryError` and its Effect cause need no SSR serializer. The browser
refetches an omitted query and receives a fresh typed error if the endpoint fails again.

The example's `/http-failure` route catches the loader rejection so rendering can continue, then
uses the same generated query options in `useQuery`. The browser renders the new error's group,
endpoint, operation, and cause. Successful decoded Schema class values are converted to plain data
with `structuredClone` before serialization; applications needing class methods must restore them
explicitly after hydration.

## Dehydrate an open stream

Completed query data, including a completed stream's cached value, uses TanStack's normal
dehydration contract. An open stream remains in `fetchStatus: 'fetching'`, so a server loader must
capture a successful snapshot and cancel the query before dehydration can finish:

```ts
const fetchStreamSnapshot = async (queryClient, options) => {
  let stopWatching = () => {}
  const snapshotReady = new Promise((resolve, reject) => {
    const inspect = () => {
      const state = queryClient.getQueryState(options.queryKey)
      if (state?.status === 'success') resolve()
      if (state?.status === 'error') reject(state.error)
    }
    stopWatching = queryClient.getQueryCache().subscribe(inspect)
    inspect()
  })
  const fetching = queryClient.query(options)

  try {
    await snapshotReady
    await queryClient.cancelQueries({ exact: true, queryKey: options.queryKey })
    return await fetching
  } catch (error) {
    await fetching.catch(() => undefined)
    throw error
  } finally {
    stopWatching()
  }
}
```

Cancellation closes the stream iterator and its Effect resources. The browser hydrates the server
snapshot, then may refetch according to ordinary TanStack policies.
