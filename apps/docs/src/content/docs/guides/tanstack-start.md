---
title: TanStack Start
description: Use generated query options in Start loaders, server rendering, and React components.
---

Use `effect-api-query` with your existing TanStack Start router and Effect contract. Choose the
factory for your contract, then use its generated options with TanStack Query in loaders and
components.

## Choose a factory

For an Effect RPC group, pass your ready RPC client to `createRpcQueryUtils`:

```ts
import { createRpcQueryUtils } from 'effect-api-query'

const queryUtils = createRpcQueryUtils(rpcGroup, {
  client: rpcClient,
  keyPrefix: ['app', identity],
  runPromiseExit,
})
```

For an Effect HTTP API, use `createHttpApiQueryUtils` with your ready `HttpApiClient` instead:

```ts
import { createHttpApiQueryUtils } from 'effect-api-query'

const queryUtils = createHttpApiQueryUtils(httpApi, {
  client: httpClient,
  keyPrefix: ['app', identity],
  runPromiseExit,
})
```

Here, `identity` is a safe cache partition for the current user or tenant, and `runPromiseExit`
is your application's runner. Configure transport URLs, authentication, and required services when
creating the client and runner. Use a trusted server destination for SSR and a browser-accessible
destination for client requests.

The [RPC factory reference](/effect-rpc-query/reference/factory/) and
[HTTP guide](/effect-rpc-query/guides/http-queries-and-mutations/) cover client setup, optional
runners, and request inputs. The package generates query options; your application owns the API
host, router, and providers.

## Prefetch in a loader and read in a component

Expose your `queryUtils` and application-owned `QueryClient` through the router context. For a
contract with a `users.list` operation, the same generated options work in both places:

```tsx
export const Route = createFileRoute('/users')({
  loader: ({ context }) => context.queryClient.query(context.queryUtils.users.list.queryOptions()),
  component: UsersRoute,
})

function UsersRoute() {
  const { queryUtils } = Route.useRouteContext()
  const users = useSuspenseQuery(queryUtils.users.list.queryOptions())
  return <pre>{JSON.stringify(users.data, null, 2)}</pre>
}
```

Set a suitable `staleTime` on the Query Client or generated options so successful loader data
remains fresh during hydration and navigation. Keep the same key prefix and request inputs on
the server and browser to address the same cache entry.

For pagination, pass generated `infiniteOptions` to `queryClient.infiniteQuery` in the loader and
`useInfiniteQuery` in the component. After a write, use generated `mutationOptions` and invalidate
the relevant group key. These are ordinary TanStack Query operations; see
[Cache Management](/effect-rpc-query/guides/cache-management/) and
[Generated Builders](/effect-rpc-query/reference/generated-builders/).

## Own request lifetimes and hydration

Create a fresh Query Client and request-specific client, runner, and utility tree for each
server-rendered page. Keep authentication in that request's client or runner. A key prefix can
partition cached data by identity, but does not replace separate request ownership.

Connect the router to that Query Client with TanStack's SSR integration:

```ts
import { defaultShouldDehydrateQuery } from '@tanstack/react-query'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

setupRouterSsrQueryIntegration({
  router,
  queryClient,
  dehydrateOptions: {
    shouldDehydrateQuery: defaultShouldDehydrateQuery,
  },
})
```

The server dehydrates its Query Client; the browser hydrates a browser-owned Query Client and
uses its own ready client and runner. Register cleanup with the server request lifecycle: cancel
outstanding queries before disposing their runtime when SSR finishes or the request aborts. Keep
the browser runtime alive for the browser application's lifetime.

Successful query data must satisfy your serializer's contract. If an endpoint returns decoded
Schema class instances, decide whether the browser needs plain data or reconstructed instances.
The package does not serialize query data for you.

## Let the browser refetch failed queries

Keep TanStack's `defaultShouldDehydrateQuery` policy to dehydrate successful data and omit failed
queries. The browser can then refetch an omitted query and receive a fresh `EffectRpcQueryError`
or `EffectHttpApiQueryError`, including its Effect cause, if the operation fails again. This avoids
serializing an error and its cause into the page.

When the page should render despite a loader failure, catch the loader rejection and use
`useQuery` in the component to render pending and error states. Otherwise, allow the loader error
to reach your route's error handling. See
[Handle Failures](/effect-rpc-query/guides/handle-failures/) for inspecting typed failures.

## Capture an RPC stream snapshot

Completed stream data uses TanStack's normal dehydration contract. An open RPC stream remains
in `fetchStatus: 'fetching'`. To render its first successful value, start the generated query,
wait for a successful cache snapshot, then cancel the query before dehydration completes.
Cancellation closes the iterator and releases its Effect resources. The browser hydrates the
snapshot and may refetch according to your TanStack policies.

The example's
[`fetchStreamSnapshot`](https://github.com/ueberBrot/effect-rpc-query/blob/main/examples/tanstack-start/src/lib/query-ssr.ts)
shows the cache subscription, cancellation, and cleanup needed for this pattern.

## Explore the executable example

The [TanStack Start example](https://github.com/ueberBrot/effect-rpc-query/tree/main/examples/tanstack-start)
includes separate RPC and HTTP views to demonstrate both factories. It verifies successful SSR,
hydration without duplicate reads, cached navigation, pagination, mutations, failures, and
cancellation. Its `/http-failure` route demonstrates omission and browser refetch of a failed query.
See [Executable Examples](/effect-rpc-query/examples/) for commands and controls.

The example serves RPC at `/rpc` and HTTP at `/api/$`. Both handlers share a demonstration user
directory, so writes invalidate both sets of query keys. Its authorization header is a public
demonstration value; the ownership tests use separate identities to verify cache and disposal
isolation. Its SSR setup converts decoded Schema class values to plain data with `structuredClone`.

The example also disables Vite preview compression for its API routes. The pinned middleware
delays response-close listeners until the first write, preventing a pending buffered request from
observing a disconnect. This host-specific setting lets the browser tests verify both aborted
requests and server interruption.
