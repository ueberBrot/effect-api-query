# effect-api-query

Use Effect RPC and HttpApi with typed TanStack Query options and semantic cache keys.

Create utilities from your API definition and ready client, then pass their options directly to
TanStack Query. Your application controls the client lifetime, cache policies, and framework setup.

## Install

```sh
pnpm add effect-api-query @tanstack/query-core
```

pnpm installs the exact Effect peer declared by the package. Use TypeScript 5.9 or newer with `strict: true`. The package requires ESM and ES2022 support.
Before upgrading, review [compatibility and stability](https://ueberbrot.github.io/effect-api-query/getting-started/compatibility-and-stability/).

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

## Query an RPC

Given your RPC group and ready flat client:

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

Given your HttpApi declaration and ready HTTP API client:

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

## Choose an operation

| API definition            | Available operations                          |
| ------------------------- | --------------------------------------------- |
| Unary RPC                 | Queries, infinite queries, and mutations      |
| Streaming RPC             | Accumulated streamed queries and live queries |
| Buffered HttpApi endpoint | Queries, infinite queries, and mutations      |

Both factories generate keys for cache reads, writes, prefetching, and invalidation. Query functions
forward cancellation to Effect. Mutations use TanStack's normal callbacks; invalidate affected
queries in your application.

## Integrate with your application

- [React Query](https://ueberbrot.github.io/effect-api-query/guides/react-query/): use generated options with hooks.
- [TanStack Start](https://ueberbrot.github.io/effect-api-query/guides/tanstack-start/): share RPC and HTTP options across loaders, server rendering, and hydration.
- [Run the examples](https://ueberbrot.github.io/effect-api-query/examples/): try complete Vite React and TanStack Start applications.
- [Feature support](https://ueberbrot.github.io/effect-api-query/getting-started/feature-support/): check available operations and integration limits.
- [API reference](https://ueberbrot.github.io/effect-api-query/reference/public-exports/): look up factories, builders, and errors.
