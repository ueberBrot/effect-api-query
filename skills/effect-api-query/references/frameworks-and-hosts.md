# Native frameworks, transports, and supported hosts

## Rebuild captured options from reactive input

Acquire clients and create utilities during application setup. Supply the native
framework's Query provider. Builders capture plain input at each call; invoke them
inside the framework's reactive options computation so changed input produces a
new key and query function. Mutations receive new variables at execution time.

| Framework | Native options construction                                                       |
| --------- | --------------------------------------------------------------------------------- |
| React     | Rebuild the builder result as component input changes; use ordinary Query hooks   |
| Vue       | `computed(() => rpc.users.read.queryOptions(...))` passed to `useQuery`           |
| Solid     | `useQuery(() => rpc.users.read.queryOptions(...))`                                |
| Svelte    | `createQuery(() => rpc.users.read.queryOptions(...))`                             |
| Angular   | `injectQuery(() => rpc.users.read.queryOptions(...))` inside an injection context |

Apply this pattern to infinite, metadata, accumulated, and live options too. This
factory constructs utilities once and returns hooks for native component setup:

```ts
import type { InferDataFromTag, InferErrorFromTag } from '@tanstack/query-core'
import { useQuery as useSolidQuery } from '@tanstack/solid-query'
import { useQuery as useVueQuery } from '@tanstack/vue-query'
import { Schema } from 'effect'
import { createRpcQueryUtils, skipToken } from 'effect-api-query'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'
import { computed, ref } from 'vue'

export const group = RpcGroup.make(
  Rpc.make('users.read', {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  }),
)

export function makeUserHooks(client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>) {
  const rpc = createRpcQueryUtils(group, { client, keyPrefix: ['users-app'] })
  return {
    useVueUser() {
      const id = ref<number | undefined>(1)
      const options = computed(() =>
        rpc.users.read.queryOptions({
          input: id.value === undefined ? skipToken : { id: id.value },
          select: (user) => user.name,
        }),
      )
      type Key = ReturnType<typeof rpc.users.read.queryKey>
      const user = useVueQuery<
        InferDataFromTag<unknown, Key>,
        InferErrorFromTag<Error, Key>,
        string
      >(options)
      return { id, user }
    },
    useSolidUser(id: () => number | undefined) {
      return useSolidQuery(() => {
        const value = id()
        return rpc.users.read.queryOptions({
          input: value === undefined ? skipToken : { id: value },
          select: (user) => user.name,
        })
      })
    },
  }
}
```

Vue's explicit hook generics preserve tagged data/error types while avoiding deep
recursive unwrapping of Effect Causes. Let builders infer their arguments. Vue
function-valued `enabled` is a zero-argument getter; use a boolean or `() => boolean`,
instead of Core's `enabled(query)` callback. Solid accepts the Core callback.

Solid Query 5.104.0 query/infinite overloads require a defined seed or no seed; a
possibly undefined value or initializer does not match. Vue accepts that initializer.
Explicit `initialData: undefined` overrides inherited seeds. Angular's skipped query
keeps optional `data()` even with defined initial data; Svelte preserves defined data
for that combination. Both accept possibly undefined initializers with optional data.

Compile Svelte with `module: 'ESNext'` and `moduleResolution: 'Bundler'`; NodeNext
checking exposes an upstream `.svelte` declaration import limitation. Angular results
are signals such as `data()`; register `provideTanStackQuery(queryClient)` and use an
injection context. Use native infinite and mutation hooks with the matching builders.

Last-observer removal cancels abort-aware open queries. Keep resources alive until
local finalizers finish. For an owner change, follow the ordered unmount, drain,
dispose, and remount procedure in [cache workflows](cache-workflows.md).

## Match application dependencies

Keep Effect packages coordinated with the exact package peer. Match each native
Query wrapper to the application's Query Core and use a compiler supported by
its framework tooling. Angular core, common, compiler, and platform-browser
should share one release.

## Keep transport and host ownership explicit

- **HTTP RPC:** acquire a flat client in a live application Scope with matching
  protocol and serialization, as in [RPC setup](rpc.md).
- **Shared WebSocket RPC:** concurrent unary and stream requests share the owned
  connection while retaining independent keys and cancellation. Acquire replacement
  resources after retiring the prior owner. Reconnect, backoff, authentication, and
  replay remain application policy. Local cancellation does not prove remote cleanup.
- **Server-local RPC:** a request-scoped public decoded-message client/server can
  avoid a network round trip. Server-owned services determine authority; caller
  services cannot override it. This path skips wire Schema codecs; retain a
  schema-aware protocol when their validation or effects matter.
- **Browser/dedicated worker:** each host owns its ready clients, runtime, Scope,
  and QueryClient. Worker-hosted operations do not establish cross-host `postMessage`
  transport, service/shared workers, authentication, or cache synchronization.
  Await cleanup before terminating a worker.
- **External OpenAPI HTTP:** `openapi-typescript` can generate encoded DTO types
  from native `OpenApi.fromApi` for `openapi-fetch`. That client calls HTTP
  independently and cannot replace the ready Effect HttpApiClient in the factory.
  Multipart needs explicit FormData serialization. Raw SSE bytes provide neither
  event parsing nor Schema decoding or reserved-failure handling.

With Effect 4.0.0, a shared-WebSocket control filled the native buffer of size 16
with one acknowledged 16-value chunk, consumed no values, then immediately closed
the request Scope; an active unary still succeeded. Larger chunks and unfinished
offers are outside that control's evidence. An overflowing buffer of size one can
stall other calls. A client chunk Schema failure can also fail unrelated calls;
larger buffers do not isolate decoding failures. Keep streaming schemas compatible.

Single-element arrays in GET and form-urlencoded payloads can fail native server
decoding. Array query parameters and JSON array responses retain their representation.
The factories preserve the ready client's actual execution contract; they supply
no transport batching, platform services, or framework providers. Error guards use
same-realm `instanceof`; transfer safe error DTOs deliberately across realms.

Sources: [framework guides](https://ueberbrot.github.io/effect-api-query/guides/vue-and-solid/),
[host boundaries](https://ueberbrot.github.io/effect-api-query/reference/browser-and-worker-hosts/),
[WebSocket clients](https://ueberbrot.github.io/effect-api-query/guides/websocket-clients/).
