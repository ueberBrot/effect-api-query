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

Use `identity` to partition the cache safely by the current user or tenant. `runPromiseExit`
is your application's runner. Configure transport URLs, authentication, and required services when
creating the client and runner. Use a request-owned server-local client when your application can execute the handlers locally.
Otherwise, use a trusted server destination. Browser clients use a browser-accessible destination.

The [RPC factory reference](/effect-api-query/reference/factory/) and
[HTTP guide](/effect-api-query/guides/http-queries-and-mutations/) cover client setup, optional
runners, and request inputs. The package generates query options; your application owns the API
host, router, and providers.

## Prefetch in a loader and read in a component

Expose your `queryUtils` and `QueryClient` through the router context. For a
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

Set `staleTime` on the Query Client or generated options long enough to keep successful loader
data fresh during hydration and navigation. Keep the same key prefix and request inputs on
the server and browser to address the same cache entry.

For pagination, pass generated `infiniteOptions` to `queryClient.infiniteQuery` in the loader and
`useInfiniteQuery` in the component. After a write, use generated `mutationOptions` and invalidate
the relevant group key. These are ordinary TanStack Query operations; see
[Cache Management](/effect-api-query/guides/cache-management/) and
[Generated Builders](/effect-api-query/reference/generated-builders/).

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

The server dehydrates its Query Client. The browser hydrates its own Query Client and uses its
own ready client and runner. Register cleanup with the server request lifecycle. When SSR finishes
or the request aborts, cancel outstanding queries and await outstanding snapshot captures before
disposing their ready clients and runtime. Native cancellation alone may settle before local iterator
finalizers finish. Keep the browser
runtime alive for the browser application's lifetime.

Successful query data must satisfy your serializer's contract. If an endpoint returns decoded
Schema class instances, decide whether the browser needs plain data or reconstructed instances.
The package does not serialize query data for you.
Use [Hydrate Unary Data](/effect-api-query/guides/hydrate-unary-data/) to keep a DTO representation
or pair Schema encoding and decoding across hydration and later browser refetch.

## Let the browser refetch failed queries

Keep TanStack's `defaultShouldDehydrateQuery` policy to dehydrate successful data and omit failed
queries. The browser can then refetch an omitted query and receive a fresh `EffectRpcQueryError`
or `EffectHttpApiQueryError`, including its Effect Cause, if the operation fails again. This avoids
serializing an error and its Cause into the page.

When the page should render despite a loader failure, catch the loader rejection and use
`useQuery` in the component to render pending and error states. Otherwise, allow the loader error
to reach your route's error handling. See
[Handle Failures](/effect-api-query/guides/handle-failures/) for inspecting typed failures.

## Capture a stream snapshot

Use the package's `fetchStreamSnapshot` with generated accumulated or live options when an open
RPC or HTTP SSE stream must provide data for SSR. It captures a new publication, cancels the exact
query, and waits for local iterator cleanup before settling. Dehydrate the resulting successful
cache, then dispose request-owned resources. The browser hydrates its own cache and reconnects
through its own ready client and runner.

[Stream Snapshots](/effect-api-query/guides/stream-snapshots/) covers fresh and cached modes,
timeouts, aborts, stream policies, and exclusive query ownership.

## Explore the executable example

The [TanStack Start example](https://github.com/ueberBrot/effect-api-query/tree/main/examples/tanstack-start)
includes separate RPC and HTTP views to demonstrate both factories. It verifies successful SSR,
hydration without duplicate reads, cached navigation, pagination, mutations, failures, and
cancellation. Its `/http-failure` route omits a failed query from dehydration so the browser can
refetch it.
See [Executable Examples](/effect-api-query/examples/) for commands and controls.

The example serves RPC at `/rpc` and HTTP at `/api/$`. Both handlers share a demonstration user
directory, so writes invalidate both sets of query keys. The authorization header contains a
public demonstration value. Each request owns its cache and connections; disposing one request
leaves other requests usable.

Server rendering uses request-owned connections built with Effect's public decoded-message client
and server. They execute the same application state as the network handlers. RPC execution avoids
HTTP round trips; HTTP loaders call the host's Web handler in process and retain HTTP Schema codecs.
The browser acquires separate network clients and reconnects both stream views after hydration.

Local RPC middleware captures the request's demonstration authorization value. Per-call headers and
caller execution services cannot replace that authority. The example defaults that public value to
`allowed`; replace this demonstration policy with your application's authentication. Decoded-message
RPC execution bypasses transport Schema codecs. Keep a schema-aware protocol when wire validation
or codec effects are required.

The example pairs Schema codecs for its generated query views and completes asynchronous
preparation before publishing or hydrating. Add a codec for each new hydratable view. See
[Hydrate Query Views](/effect-api-query/guides/hydrate-query-views/).
