# effect-api-query

Use your native Effect RPC and HttpApi contracts with typed TanStack Query options and semantic cache keys.

Create utilities from your API definition and a ready client, then pass their options directly to
TanStack Query. Your application controls the client lifetime, cache policies, and framework setup.

## Install

```sh
pnpm add effect-api-query @tanstack/query-core
```

With automatic peer installation enabled, pnpm installs the exact Effect version declared by the
package. Use TypeScript 5.9 or newer with `strict: true`. The package requires ESM and ES2022 support.
Before upgrading, review [compatibility and stability](https://ueberbrot.github.io/effect-api-query/getting-started/compatibility-and-stability/).

## Query an RPC

Pass your RPC group and ready flat client to the factory:

```ts
import { createRpcQueryUtils } from 'effect-api-query'

const rpc = createRpcQueryUtils(rpcGroup, {
  client,
  keyPrefix: ['my-app'],
  runPromiseExit,
})

const options = rpc.users.get.queryOptions({ input: { id: 1 } })
const user = await queryClient.query(options)
```

Follow the [RPC quick start](https://ueberbrot.github.io/effect-api-query/getting-started/quick-start/)
for setup and cleanup.

## Query an HttpApi

Pass your HttpApi declaration and ready HTTP API client to the factory:

```ts
import { createHttpApiQueryUtils } from 'effect-api-query'

const http = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ['my-app'],
  runPromiseExit,
})

const options = http.users.get.queryOptions({ input: { params: { id: 1 } } })
const user = await queryClient.query(options)
```

HTTP accepts decoded request parts; RPC accepts payload constructor input. Follow the
[HTTP quick start](https://ueberbrot.github.io/effect-api-query/getting-started/http-quick-start/)
for a complete declaration, client, query, and mutation.

Use `metadataOptions` for response status and headers; follow the
[ETag recipe](https://ueberbrot.github.io/effect-api-query/guides/http-queries-and-mutations/#update-with-an-etag)
for conditional writes.

## Choose an operation

| API definition                              | Available operations                               |
| ------------------------------------------- | -------------------------------------------------- |
| Unary RPC                                   | Queries, infinite queries, and mutations           |
| Streaming RPC                               | Accumulated streamed queries and live queries      |
| Buffered HttpApi endpoint without multipart | Queries, metadata, infinite queries, and mutations |
| Buffered HttpApi endpoint with multipart    | Mutations with `FormData`                          |
| Unambiguous HttpApi SSE endpoint            | Accumulated streamed queries and live queries      |

Both factories generate keys for cache reads, writes, prefetching, and invalidation. Query functions
forward cancellation to Effect. Mutations use TanStack's normal callbacks; invalidate affected
queries in your application.

For uploads, build `FormData` explicitly and pass it as mutation `payload`. See the
[HTTP upload guide](https://ueberbrot.github.io/effect-api-query/guides/http-queries-and-mutations/#upload-a-file).
Mixed HTTP success modes, raw byte streams, and streaming multipart requests remain omitted. See
the [SSE guide](https://ueberbrot.github.io/effect-api-query/guides/http-queries-and-mutations/#retain-sse-events)
for accumulated HTTP event queries.

## Integrate with your application

- [React Query](https://ueberbrot.github.io/effect-api-query/guides/react-query/): use generated options with hooks.
- [Vue and Solid](https://ueberbrot.github.io/effect-api-query/guides/vue-and-solid/) and [Svelte and Angular](https://ueberbrot.github.io/effect-api-query/guides/svelte-and-angular/): rebuild options from reactive input with native Query integrations.
- [TanStack Start](https://ueberbrot.github.io/effect-api-query/guides/tanstack-start/): share RPC and HTTP options across loaders, server rendering, and hydration.
- [Stream snapshots](https://ueberbrot.github.io/effect-api-query/guides/stream-snapshots/): capture open streams and await local cleanup before server disposal.
- [Hydrate Unary Data](https://ueberbrot.github.io/effect-api-query/guides/hydrate-unary-data/) and [Query Views](https://ueberbrot.github.io/effect-api-query/guides/hydrate-query-views/): keep DTOs or reconstructed Schema values consistent across JSON hydration and refetch.
- [Switch cache owners](https://ueberbrot.github.io/effect-api-query/guides/switch-cache-owners/) and [refresh from events](https://ueberbrot.github.io/effect-api-query/guides/refresh-from-events/): coordinate application-owned writes, persistence, and invalidation.
- [Run the examples](https://ueberbrot.github.io/effect-api-query/examples/): try complete Vite React and TanStack Start applications.
- [Feature support](https://ueberbrot.github.io/effect-api-query/getting-started/feature-support/): check available operations and integration limits.
- [Performance and bundling](https://ueberbrot.github.io/effect-api-query/reference/performance/): assess construction, compiler, and bundle costs.
- [API reference](https://ueberbrot.github.io/effect-api-query/reference/public-exports/): look up factories, builders, and errors.

## Agent skill

Install the library usage skill from this repository:

```sh
npx skills add ueberBrot/effect-api-query --skill effect-api-query
```

The same skill ships in the npm package. With the library installed, run
`npx @tanstack/intent@latest install` and enable `effect-api-query`, then load it with:

```sh
npx @tanstack/intent@latest load effect-api-query#effect-api-query
```

Intent reads the skill from the installed library version. Skills installed from
GitHub are updated separately through the Skills CLI.
