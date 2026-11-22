# Native frameworks, transports, and supported hosts

Use the [integration overview](https://ueberbrot.github.io/effect-api-query/integrations/) to choose a native framework hook or router setup.

## Rebuild captured options from reactive input

Acquire clients and build utilities during app setup. Give the provider the owning QueryClient. Call builders inside the framework's reactive options computation so changes create fresh input, key, and query function. Pass mutation variables when the mutation runs.

| Framework | Native options construction |
| --- | --- |
| React | Rebuild the builder result as component input changes and use ordinary Query hooks |
| Vue | `computed(() => rpc.users.read.queryOptions(...))` passed to `useQuery` |
| Solid | `useQuery(() => rpc.users.read.queryOptions(...))` |
| Svelte | `createQuery(() => rpc.users.read.queryOptions(...))` |
| Angular | `injectQuery(() => rpc.users.read.queryOptions(...))` inside an injection context |

Reuse the same pattern for pages, metadata, and streams. This factory builds utilities once and returns hooks for components.

```ts
import { useQuery as useSolidQuery } from "@tanstack/solid-query";
import { useQuery as useVueQuery } from "@tanstack/vue-query";
import { createRpcQueryUtils, skipToken } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";
import { computed, ref } from "vue";

export const group = RpcGroup.make(
  Rpc.make("users.read", {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  })
);

export function makeUserHooks(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>
) {
  const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["users-app"] });
  return {
    useVueUser() {
      const id = ref<number | undefined>(1);
      const options = computed(() =>
        rpc.users.read.queryOptions({
          input: id.value === undefined ? skipToken : { id: id.value },
          select: (user) => user.name,
        })
      );
      const user = useVueQuery(options);
      return { id, user };
    },
    useSolidUser(id: () => number | undefined) {
      return useSolidQuery(() => {
        const value = id();
        return rpc.users.read.queryOptions({
          input: value === undefined ? skipToken : { id: value },
          select: (user) => user.name,
        });
      });
    },
  };
}
```

Let the builder and hook infer data and errors. For Vue, set `enabled` to a boolean or a zero-argument getter. Solid can use Core's `enabled(query)` callback.

In the tested versions, Solid query and infinite hooks accept a defined seed or no seed. Vue accepts a possibly undefined initializer. Its computed overload can return optional data even with a defined seed. Use `initialData: undefined` to clear an inherited seed. With `skipToken` and defined initial data, Angular returns optional data and Svelte returns defined data. Both accept possibly undefined initializers and return optional data then.

For Svelte, set `module: 'ESNext'` and `moduleResolution: 'Bundler'` for its `.svelte` declarations. In Angular, register `provideTanStackQuery(queryClient)` and call query hooks inside an injection context. Results are signals such as `data()`.

When the last ordinary observer leaves, TanStack can cancel an abort-aware query. Keep the client alive through local finalizers. To switch owners, follow [cache workflows](cache-workflows.md#replace-an-owner-in-order).

## Mount a provider and recover Suspense

Run the [HTTP workflows](https://ueberbrot.github.io/effect-api-query/examples/http-workflows/) for typed errors, uploads, stream sharing, and recovery. Start's browser workflow uses a separate owner from server rendering. Its featured-user loader transfers a selection that the browser rebinds before reading the cache.

For React, acquire one client, build the utilities and QueryClient, then mount `QueryClientProvider`. Unmount consumers and await disposal. See the [complete React setup](https://ueberbrot.github.io/effect-api-query/guides/react-query/#acquire-and-mount-the-client).

Wrap the React error boundary and Suspense in `QueryErrorResetBoundary`. On retry, reset both error states. If a background refetch fails while data exists, the screen can still render that data. Show the error locally after fetching stops, or explicitly throw it for boundary recovery.

For independent reads, pass generated options to `useSuspenseQueries` to start them together. Use ordinary hooks or observers if cancellation matters. Suspense hooks reject skipped options. See [Suspense recovery](https://ueberbrot.github.io/effect-api-query/guides/suspense-and-recovery/).

## Match application dependencies

Use the [compatibility table](https://ueberbrot.github.io/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) to select library peers and framework wrappers. The packed checks pair each listed Effect release with both Query Core pins. The framework checks use the development combination. Use a compiler supported by the framework's tooling.

Match Effect runtime, testing, and platform releases within the installed package's peer range. The repo uses Effect-enhanced TSRS for development. The minimum checked consumer compiler is TypeScript 5.9.3.

Before 1.0, breaking contracts, new capabilities, and support changes can appear in minor releases. See [compatibility and stability](https://ueberbrot.github.io/effect-api-query/getting-started/compatibility-and-stability/) for the release policy.

Keep app and wrapper on one resolved Query Core version. Keep Angular core, common, compiler, and platform-browser on the same release.

Match the site's version badge to the installed package before applying its examples. For another version, use the installed declarations and guidance.

## Keep transport and host ownership explicit

Choose the transport your application already owns.

- HTTP RPC needs a flat client in a live Scope and matching serialization. Follow [RPC setup](rpc.md).
- With a shared WebSocket, unary and stream requests keep distinct keys and cancellation. Retire the old owner before replacing connections. Set reconnect, backoff, authentication, and replay in the app. Wait for a server acknowledgement if you need proof of cleanup.
- Server-local RPC can use public decoded messages inside the request Scope. Server-owned services define authority. Use a schema-aware protocol when wire validation or codec effects matter.
- A browser window or dedicated worker owns its client, runtime, Scope, and cache. Configure cross-host transport, authentication, and synchronization separately. Wait for worker cleanup before termination.
- Use `openapi-typescript` with `OpenApi.fromApi` for encoded DTO types and `openapi-fetch` for direct HTTP. Supply multipart serialization and an SSE decoder if needed. Pass an Effect HttpApiClient to the factory.

The app supplies transport batching, platform services, and providers. Execution guards use same-realm `instanceof`. Across realms, transfer a safe error DTO.

See [Vue](https://ueberbrot.github.io/effect-api-query/guides/vue-query/), [Solid](https://ueberbrot.github.io/effect-api-query/guides/solid-query/), [Svelte](https://ueberbrot.github.io/effect-api-query/guides/svelte-query/), and [Angular](https://ueberbrot.github.io/effect-api-query/guides/angular-query/) for native hooks. See [worker hosts](https://ueberbrot.github.io/effect-api-query/reference/browser-and-worker-hosts/) and [WebSocket clients](https://ueberbrot.github.io/effect-api-query/guides/websocket-clients/) for transport setup.

See [query owner setup](cache-workflows.md#opt-in-to-query-owner-setup) for acquired and borrowed resources. For execution errors, follow [failure handling](https://ueberbrot.github.io/effect-api-query/guides/handle-failures/) and [retry queries](https://ueberbrot.github.io/effect-api-query/guides/retry-queries/).
