---
title: TanStack Router and Start
description: Reuse generated options in Router loaders and components, then connect Start request ownership and hydration.
---

Use the same generated options in a TanStack Router loader and Query hook. Start uses that pattern for server rendering too.

Create `queryUtils` with the [RPC](/effect-api-query/getting-started/quick-start/) or [HTTP](/effect-api-query/getting-started/http-quick-start/) factory. Put it and its QueryClient in router context. Use a safe cache prefix and a runner that forwards the abort signal.

## Reuse options in a Router loader and component

In the route module, load `users.list` with the context's QueryClient and utilities. Register the existing `UsersRoute` component.

```tsx
export const Route = createFileRoute("/users")({
  loader: ({ context }) =>
    context.queryClient.query(context.queryUtils.users.list.queryOptions()),
  component: UsersRoute,
});
```

Inside `UsersRoute`, pass the same options to the hook.

```ts
const { queryUtils } = Route.useRouteContext();
const users = useSuspenseQuery(queryUtils.users.list.queryOptions());
```

Set `staleTime` long enough to keep loader data fresh during hydration and navigation. Use the same prefixes and inputs on the server and browser so the options address the same cache entry.

For pages, pass `infiniteOptions` to `queryClient.infiniteQuery` in the loader and `useInfiniteQuery` in the component. After a write, use the relevant group key to mark reads stale. See [cache filters](/effect-api-query/guides/cache-filters/) and [RPC builders](/effect-api-query/reference/generated-builders/).

## Add Start server rendering

For a browser-only Router app, use the loader and hook above. In Start, connect the native SSR Query integration.

### Own request lifetimes and hydration

For each request, create a QueryClient, ready client, runner, and utility tree. Keep authentication in that request's client or runner. A user or tenant prefix partitions keys within a cache. Use request-local resources as well.

Connect the router to the request's QueryClient with TanStack's SSR integration.

```ts
import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

setupRouterSsrQueryIntegration({
  router,
  queryClient,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) &&
      query.state.error === null &&
      query.state.fetchFailureReason === null,
  },
});
```

Dehydrate the server QueryClient and hydrate a separate browser QueryClient. Register cleanup with the server request. When rendering completes or the request aborts, cancel outstanding queries. Await snapshot captures and local iterator cleanup before releasing clients and runners.

Keep browser resources alive while the browser app uses them.

Use `createContractHydrationRegistry` to transfer decoded classes and other rich values. The [example snapshot module](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/lib/snapshot-preparation.ts) combines the RPC and HTTP registries before the router publishes or hydrates a snapshot. For a single DTO or custom codec, see [hydrate unary data](/effect-api-query/guides/hydrate-unary-data/) to preserve the same shape across hydration and later browser fetches.

## Let the browser refetch failed queries

The default filter omits queries with an error status. A successful entry can still hold an earlier failure. The filter above also omits queries with an error or fetch failure reason. The browser can refetch those queries with its own client.

If a loader failure must still render the page, catch the rejection. Then use `useQuery` in the component for pending and error states. Otherwise let the route handle the loader error. See [handle failures](/effect-api-query/guides/handle-failures/) to inspect its Cause.

## Capture a stream snapshot

For an open stream, use `fetchStreamSnapshot` with accumulated or live options. It captures a publication and waits for local iterator cleanup before settling. Dehydrate the successful result, dispose of the request resources, and let the browser reconnect with its own client.

See [stream snapshots](/effect-api-query/guides/stream-snapshots/) for capture modes, timeouts, aborts, and exclusive access to the key.

## Explore the executable example

[Run the Start app](/effect-api-query/examples/#run-tanstack-start) to try both adapters. Use the source for the integration you need.

| Task | Complete source |
| --- | --- |
| Router context and Query integration | [router.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/router.tsx) |
| Paired codecs and snapshot preparation | [query-ssr.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/lib/query-ssr.ts), [snapshot-preparation.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/lib/snapshot-preparation.ts) |
| Request-owned clients and cleanup | [server-application.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/lib/server-application.ts) |
| HTTP failure followed by browser refetch | [http-failure.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/routes/http-failure.tsx) |

Use trusted destinations on the server. The example's request-local RPC middleware captures server authority that callers cannot override. If the request needs wire validation or codec effects, use a schema-aware protocol. Decoded-message RPC bypasses transport codecs. Browser clients use separate network resources.
