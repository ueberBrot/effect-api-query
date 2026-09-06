# effect-api-query

Use Effect RPC and HttpApi with typed TanStack Query options and semantic cache keys.

Create utilities from your API definition and ready client, then pass their options directly to
TanStack Query. Your application controls the client lifetime, cache policies, and framework setup.

## Install

```sh
pnpm add effect-api-query effect@4.0.0-rc.112 @tanstack/query-core@^5.102.0
```

Use TypeScript 5.9 or newer with `strict: true`. The package requires ESM and ES2022 support.
Before upgrading, review [compatibility and stability](https://ueberbrot.github.io/effect-rpc-query/getting-started/compatibility-and-stability/).

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

Follow the [RPC quick start](https://ueberbrot.github.io/effect-rpc-query/getting-started/quick-start/)
for setup and cleanup. For an Effect HttpApi, use
[`createHttpApiQueryUtils`](https://ueberbrot.github.io/effect-rpc-query/guides/http-queries-and-mutations/).

## Choose an operation

| API definition            | Available operations                          |
| ------------------------- | --------------------------------------------- |
| Unary RPC                 | Queries, infinite queries, and mutations      |
| Streaming RPC             | Accumulated streamed queries and live queries |
| Buffered HttpApi endpoint | Queries and mutations                         |

Both factories generate keys for cache reads, writes, prefetching, and invalidation. Query functions
forward cancellation to Effect. Mutations use TanStack's normal callbacks; invalidate affected
queries in your application.

## Integrate with your application

- [React Query](https://ueberbrot.github.io/effect-rpc-query/guides/react-query/): use generated options with hooks.
- [TanStack Start](https://ueberbrot.github.io/effect-rpc-query/guides/tanstack-start/): share RPC options across loaders, server rendering, and hydration.
- [Run the examples](https://ueberbrot.github.io/effect-rpc-query/examples/): try complete Vite React and TanStack Start applications.
- [Feature support](https://ueberbrot.github.io/effect-rpc-query/getting-started/feature-support/): check available operations and integration limits.
- [API reference](https://ueberbrot.github.io/effect-rpc-query/reference/public-exports/): look up factories, builders, and errors.
