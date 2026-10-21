---
title: TanStack Router and Start
description: Reuse generated options in Router loaders and components, then connect Start request ownership and hydration.
---

Use generated options with TanStack Router loaders and native Query hooks. TanStack Start adds server rendering to the same Router and Query integration. Choose the factory for your Effect contract and expose its utility tree beside the QueryClient in router context.

Create `queryUtils` with the [RPC](/effect-api-query/getting-started/quick-start/) or [HTTP](/effect-api-query/getting-started/http-quick-start/) factory in your client module. Expose it and its QueryClient through router context. Use a safe identity prefix and a runner that forwards the signal. The application owns the router, providers, API host, and authentication.

## Reuse options in a Router loader and component

Expose `queryUtils` and `QueryClient` through router context. For a contract with `users.list`, use the same generated options in the loader and component. In the route module, register the loader and the existing `UsersRoute` component:

```tsx
export const Route = createFileRoute("/users")({
  loader: ({ context }) =>
    context.queryClient.query(context.queryUtils.users.list.queryOptions()),
  component: UsersRoute,
});
```

Inside `UsersRoute`, read the same options with the native hook:

```ts
const { queryUtils } = Route.useRouteContext();
const users = useSuspenseQuery(queryUtils.users.list.queryOptions());
```

Set `staleTime` on the Query Client or generated options long enough to keep successful loader data fresh during hydration and navigation. Keep the same key prefix and request inputs on the server and browser to address the same cache entry.

For pagination, pass generated `infiniteOptions` to `queryClient.infiniteQuery` in the loader and `useInfiniteQuery` in the component. After a write, use generated `mutationOptions` and invalidate the relevant group key. These use ordinary TanStack Query operations. See [Cache Keys and Filters](/effect-api-query/guides/cache-filters/) and [Generated Builders](/effect-api-query/reference/generated-builders/).

## Add Start server rendering

The loader and component pattern also works in a browser-only TanStack Router application. For Start or another server-rendered host, connect native SSR query integration. Give each request its own resources and serialization contract.

### Own request lifetimes and hydration

For each server-rendered page, create a fresh Query Client and a request-specific client, runner, and utility tree. Keep authentication in that request's client or runner. A key prefix partitions cached data by identity. Each request still needs its own resources.

Connect the router to that Query Client with TanStack's SSR integration:

```ts
import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

setupRouterSsrQueryIntegration({
  router,
  queryClient,
  dehydrateOptions: {
    shouldDehydrateQuery: defaultShouldDehydrateQuery,
  },
});
```

The server dehydrates its Query Client. The browser hydrates its own Query Client and uses its own ready client and runner. Register cleanup with the server request lifecycle. When SSR finishes or the request aborts, cancel outstanding queries. Await outstanding snapshot captures before disposing their ready clients and runtime. Native cancellation alone can settle before local iterator finalizers finish.

Keep the browser runtime alive for the browser application's lifetime.

Successful query data must satisfy your serializer's contract. If an endpoint returns decoded Schema class instances, decide whether the browser needs plain data or reconstructed instances. The package does not serialize query data for you. Use [Hydrate Unary Data](/effect-api-query/guides/hydrate-unary-data/) to keep a DTO representation or pair Schema encoding and decoding across hydration and later browser refetch.

## Let the browser refetch failed queries

Keep TanStack's `defaultShouldDehydrateQuery` policy to dehydrate successful data and omit failed queries. The browser can then refetch an omitted query and receive a fresh `EffectRpcQueryError` or `EffectHttpApiQueryError`, including its Effect Cause, if the operation fails again. This avoids serializing an error and its Cause into the page.

If the page needs to render despite a loader failure, catch the loader rejection and use `useQuery` in the component to render pending and error states. Otherwise, allow the loader error to reach your route's error handling. See [Handle Failures](/effect-api-query/guides/handle-failures/) for inspecting typed failures.

## Capture a stream snapshot

Use the package's `fetchStreamSnapshot` with generated accumulated or live options when an open RPC or HTTP SSE stream must provide data for SSR. It captures a new publication, cancels the exact query, and waits for local iterator cleanup before settling. Dehydrate the resulting successful cache, then dispose request-owned resources. The browser hydrates its own cache and reconnects through its own ready client and runner.

[Stream Snapshots](/effect-api-query/guides/stream-snapshots/) covers fresh and cached modes, timeouts, aborts, stream policies, and exclusive query ownership.

## Explore the executable example

[Run the Start application](/effect-api-query/examples/) for both adapters. Copy the integration you need:

| Task | Complete source |
| --- | --- |
| Router context and Query integration | [router.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/router.tsx) |
| Paired codecs and snapshot preparation | [query-ssr.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/lib/query-ssr.ts), [snapshot-preparation.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/lib/snapshot-preparation.ts) |
| Request-owned clients and cleanup | [server-application.ts](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/lib/server-application.ts) |
| HTTP failure followed by browser refetch | [http-failure.tsx](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/routes/http-failure.tsx) |

Server destinations must be trusted. The example uses request-owned server-local RPC execution. Its middleware captures server-owned authority that per-call headers or caller services cannot replace. Decoded-message RPC bypasses transport Schema codecs, so use a schema-aware protocol when wire validation or codec effects matter. Browser clients acquire separate network resources.
