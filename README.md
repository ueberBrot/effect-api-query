# effect-rpc-query

Type-safe TanStack Query utilities generated from Effect RPC definitions.

`effect-rpc-query` turns dotted unary and streaming RPC tags into a typed utility tree. Its builders
produce Query Core options and semantic cache keys while your application owns the RPC client,
Query Client, and lifecycle.

## Install

```sh
pnpm add effect-rpc-query effect @tanstack/query-core
```

The current source targets Effect 4, TanStack Query 5, strict TypeScript, ESM, and ES2022. The
package is under active development before its first stable release.

## Use

```ts
import { createRpcQueryUtils } from 'effect-rpc-query'

const rpcQuery = createRpcQueryUtils(rpcGroup, {
  client,
  keyPrefix: ['my-app'] as const,
  runPromiseExit,
})

const options = rpcQuery.users.get.queryOptions({ input: { id: 1 } })
```

Read the [documentation](https://ueberbrot.github.io/effect-rpc-query/) for setup, React Query,
TanStack Start, cache keys, cancellation, failures, and the API reference.

## Feature support

| Capability                            | Status            | Boundary                                                                                         |
| ------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| Unary queries and mutations           | Generated         | Typed options, semantic keys, conditional queries, and mutations                                 |
| Infinite queries                      | Generated         | Typed page parameters, semantic initial-page keys, conditional queries, and cancellation         |
| Accumulated and live streams          | Generated         | Typed stream elements, semantic keys, refetch behavior, cancellation, and complete Effect Causes |
| Native TanStack Query APIs            | Tested            | Query Core, React Query, Router loaders, TanStack Start, and `QueryClient` cache operations      |
| Transport and application integration | Application-owned | RPC client lifetime, providers, policies, Devtools, persistence, and framework integration       |
| Automatic policy                      | Application-owned | Invalidation, interceptors, defaults, and framework lifecycle                                    |
| Mutation cancellation                 | Impossible        | TanStack mutation functions provide no abort signal                                              |

See the [full capability matrix](https://ueberbrot.github.io/effect-rpc-query/getting-started/feature-support/)
for the exact boundary of each feature.

## Develop

The repository includes executable [Vite React](./examples/vite-react) and
[TanStack Start](./examples/tanstack-start) applications. Run `vp run vite-react-dev` or
`vp run tanstack-start-dev` from the repository root. Run the complete validation suite with
`vp run validate`.

See the [Dev Container guide](https://ueberbrot.github.io/effect-rpc-query/contributing/dev-container/)
for the reproducible environment.

## Design influences

The design draws on
[tRPC's TanStack React Query integration](https://github.com/trpc/trpc/tree/main/packages/tanstack-react-query)
and [Effect Query](https://github.com/voidhashcom/effect-query). It builds directly on
[Effect](https://github.com/Effect-TS/effect) and
[TanStack Query](https://github.com/TanStack/query).
