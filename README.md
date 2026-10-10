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

In the application client module, use your existing RPC group, ready flat client and runner:

```ts
import { createRpcQueryUtils } from 'effect-api-query'

const rpc = createRpcQueryUtils(rpcGroup, {
  client,
  keyPrefix: ['my-app'],
  runPromiseExit,
})
```

In a loader or event handler, use the application's QueryClient:

```ts
const options = rpc.users.get.queryOptions({ input: { id: 1 } })
const user = await queryClient.query(options)
```

Follow the [RPC quick start](https://ueberbrot.github.io/effect-api-query/getting-started/quick-start/)
for setup and cleanup.

## Query an HttpApi

In the application client module, use your existing HttpApi, ready client and runner:

```ts
import { createHttpApiQueryUtils } from 'effect-api-query'

const http = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ['my-app'],
  runPromiseExit,
})
```

In a loader or event handler:

```ts
const options = http.users.get.queryOptions({ input: { params: { id: 1 } } })
const user = await queryClient.query(options)
```

HTTP accepts decoded request parts; RPC accepts payload constructor input. Follow the
[HTTP quick start](https://ueberbrot.github.io/effect-api-query/getting-started/http-quick-start/)
for a complete declaration, client, query, and mutation.

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

Multipart payloads use explicit `FormData`. Mixed HTTP success modes, raw byte streams and
streaming multipart requests are omitted; see [feature support](https://ueberbrot.github.io/effect-api-query/getting-started/feature-support/).

## Integrate with your application

- [React Query](https://ueberbrot.github.io/effect-api-query/guides/react-query/): use generated options with hooks.
- [Vue Query](https://ueberbrot.github.io/effect-api-query/guides/vue-query/), [Solid Query](https://ueberbrot.github.io/effect-api-query/guides/solid-query/), [Svelte Query](https://ueberbrot.github.io/effect-api-query/guides/svelte-query/), and [Angular Query](https://ueberbrot.github.io/effect-api-query/guides/angular-query/): rebuild options from reactive input with native Query integrations.
- [TanStack Start](https://ueberbrot.github.io/effect-api-query/guides/tanstack-start/): share RPC and HTTP options across loaders, server rendering, and hydration.
- [Run the examples](https://ueberbrot.github.io/effect-api-query/examples/): copy complete Vite React and Start integrations.
- [API reference](https://ueberbrot.github.io/effect-api-query/reference/public-exports/): look up builders, cache views and errors.

## Agent skill

Install the library usage skill from this repository:

```sh
npx skills add ueberBrot/effect-api-query --full-depth --skill effect-api-query
```

The same skill ships in the npm package. With the library installed, run
`npx @tanstack/intent@latest install` and enable `effect-api-query`, then load it with:

```sh
npx @tanstack/intent@latest load effect-api-query#effect-api-query
```

Intent reads the skill from the installed library version. Skills installed from
GitHub are updated separately through the Skills CLI.
