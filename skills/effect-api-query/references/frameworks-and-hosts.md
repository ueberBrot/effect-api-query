# Native frameworks, transports, and supported hosts

To choose a framework, router, or host, read the [integration overview](https://ueberbrot.github.io/effect-api-query/integrations/). It describes native consumers and application lifetime boundaries.

## Rebuild captured options from reactive input

During application setup, acquire clients and create utilities. Supply the native framework's Query provider. Builders capture plain input at each call. Invoke them inside the framework's reactive options computation. Input changes then produce a new key and query function. Mutations receive new variables at execution time.

| Framework | Native options construction |
| --- | --- |
| React | Rebuild the builder result as component input changes and use ordinary Query hooks |
| Vue | `computed(() => rpc.users.read.queryOptions(...))` passed to `useQuery` |
| Solid | `useQuery(() => rpc.users.read.queryOptions(...))` |
| Svelte | `createQuery(() => rpc.users.read.queryOptions(...))` |
| Angular | `injectQuery(() => rpc.users.read.queryOptions(...))` inside an injection context |

Use the same pattern for infinite, metadata, accumulated, and live options. The following factory constructs utilities once and returns hooks for native component setup:

```ts
import { useQuery as useSolidQuery } from "@tanstack/solid-query";
import { useQuery as useVueQuery } from "@tanstack/vue-query";
import { createRpcQueryUtils, skipToken } from "@ueberbrot/effect-api-query";
import type {
  InferQueryData,
  InferQueryError,
} from "@ueberbrot/effect-api-query";
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
      const user = useVueQuery<
        InferQueryData<typeof rpc.users.read>,
        InferQueryError<typeof rpc.users.read>,
        string
      >(options);
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

Vue's explicit hook generics preserve tagged data and error types. They avoid deep recursive unwrapping of Effect Causes. Let builders infer their arguments. In Vue, function-valued `enabled` is a zero-argument getter. Use a boolean or `() => boolean`. Vue does not use Core's `enabled(query)` callback. Solid accepts that Core callback.

Solid Query 5.104.0 query and infinite overloads require a defined seed or no seed. A possibly undefined value or initializer does not match. Vue accepts that initializer. Explicit `initialData: undefined` overrides inherited seeds. Angular's skipped query keeps optional `data()` even with defined initial data. Svelte preserves defined data for that combination. Angular and Svelte both accept possibly undefined initializers with optional data.

Compile Svelte with `module: 'ESNext'` and `moduleResolution: 'Bundler'`. NodeNext checking exposes an upstream limitation with imports in `.svelte` declarations. Angular results are signals such as `data()`. Register `provideTanStackQuery(queryClient)` and use an injection context. Use native infinite and mutation hooks with their matching builders.

For ordinary Query hooks and observers, removing the last observer cancels abort-aware open queries. Keep resources alive until local finalizers finish. When changing an owner, follow the ordered unmount, drain, dispose, and remount procedure in [cache workflows](cache-workflows.md).

## Mount a provider and recover Suspense

For a first React integration, acquire one client. Create the utility tree and QueryClient once, then mount `QueryClientProvider`. Before disposing the application's client resources, unmount consumers. For one acquired HTTP client, one component, and an awaited cleanup function, use [the React client setup](https://ueberbrot.github.io/effect-api-query/guides/react-query/#acquire-and-mount-the-client).

Put `QueryErrorResetBoundary` around a component error boundary and Suspense. On retry, reset both error boundaries before rendering the component's queries again. With cached data, a failed refetch normally keeps rendering that data. When fetching stops, show the local error. If the application wants boundary recovery, explicitly throw the error.

For independent reads that need to start together, use `useSuspenseQueries`. Its native overload can require explicit `{ queryFnData, error }` type descriptors derived with the inference helpers. For the boundary and parallel-query signatures, follow [the complete Suspense recipe](https://ueberbrot.github.io/effect-api-query/guides/suspense-and-recovery/). Native Suspense query hooks do not support cancellation. If abort and open-stream cleanup are required, use ordinary Query hooks or observers. Suspense hooks do not accept skipped query options.

## Match application dependencies

Keep Effect packages coordinated with the exact package peer. Match each native Query wrapper to the application's Query Core. Use a compiler that its framework tooling supports. Keep Angular core, common, compiler, and platform-browser on the same release.

Check the website's header version before applying its examples. When it differs from the installed package, use that package's declarations and shipped guidance. The repository's `main` branch can contain unreleased behavior.

## Keep transport and host ownership explicit

The application owns the transport and host resources in each integration:

- HTTP RPC requires a flat client in a live application Scope with matching protocol and serialization. Follow [RPC setup](rpc.md) to acquire it.
- Shared WebSocket RPC lets concurrent unary and stream requests share the owned connection. They retain independent keys and cancellation. After retiring the prior owner, acquire replacement resources. The application owns reconnect, backoff, authentication, and replay policy. Local cancellation does not prove remote cleanup.
- Server-local RPC can avoid a network round trip through a request-scoped public decoded-message client and server. Server-owned services determine authority. Caller services cannot override it. This path skips wire Schema codecs. If their validation or effects matter, retain a schema-aware protocol.
- Browser and dedicated worker hosts each own their ready clients, runtime, Scope, and QueryClient. Worker-hosted operations do not establish cross-host `postMessage` transport, service or shared workers, authentication, or cache synchronization. Before terminating a worker, await cleanup.
- External OpenAPI HTTP can use `openapi-typescript` to generate encoded DTO types from native `OpenApi.fromApi` for `openapi-fetch`. That client calls HTTP independently. It cannot replace the ready Effect HttpApiClient in the factory. Multipart needs explicit FormData serialization. Raw SSE bytes provide no event parsing, Schema decoding, or reserved-failure handling.

The factories preserve the ready client's actual execution contract. They supply no transport batching, platform services, or framework providers. Error guards use same-realm `instanceof`. Across realms, explicitly transfer safe error DTOs.

Sources: [Vue Query](https://ueberbrot.github.io/effect-api-query/guides/vue-query/), [Solid Query](https://ueberbrot.github.io/effect-api-query/guides/solid-query/), [Svelte Query](https://ueberbrot.github.io/effect-api-query/guides/svelte-query/), [Angular Query](https://ueberbrot.github.io/effect-api-query/guides/angular-query/), [host boundaries](https://ueberbrot.github.io/effect-api-query/reference/browser-and-worker-hosts/), [WebSocket clients](https://ueberbrot.github.io/effect-api-query/guides/websocket-clients/).
