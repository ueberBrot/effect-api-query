---
title: Feature Support
description: Check which capabilities the package generates, tests, leaves to the application, or does not support.
---

`effect-rpc-query` turns unary and streaming Effect RPC definitions into semantic keys and TanStack
Query Core options. Applications continue to configure TanStack Query and manage the RPC client.

## Status definitions

- **Generated**: the package creates the key, function, or option object.
- **Tested**: generated options work with the listed native TanStack API without a package-specific
  wrapper.
- **Application-owned**: use the upstream Effect, TanStack, or framework API directly.
- **Impossible**: the upstream TanStack contract provides no seam for this capability.
- **Uncertified**: the package does not guarantee compatibility with this integration.

## Capability matrix

| Capability                                              | Status            | Boundary                                                                                                                                                |
| ------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unary RPC queries                                       | Generated         | Each unary leaf builds `queryOptions` and semantic `queryKey` values with inferred input, data, and failure types.                                      |
| Infinite queries                                        | Generated         | Each unary leaf builds `infiniteOptions` and `infiniteKey` values with inferred page parameters, payloads, data, selected data, and failures.           |
| Unary RPC mutations                                     | Generated         | Each unary leaf builds `mutationOptions` and a stable `mutationKey`; variables remain inferred at execution.                                            |
| Accumulated streamed queries                            | Generated         | Each streaming leaf builds `streamedOptions` and `streamedKey`; values accumulate in emission order.                                                    |
| Live queries                                            | Generated         | Each streaming leaf builds `liveOptions` and `liveKey`; every value replaces the previous cached value.                                                 |
| Hierarchical cache keys                                 | Generated         | Root, branch, RPC, query, infinite, streamed, live, and mutation keys support native array-prefix matching without collisions.                          |
| Conditional queries                                     | Generated         | Payload-bearing ordinary, infinite, accumulated-stream, and live builders accept TanStack's exact `skipToken` value.                                    |
| Query cancellation                                      | Generated         | Every query function forwards TanStack's `AbortSignal`; stream cancellation also closes the iterator and its Effect resources.                          |
| Query policies, transformations, and stream refetching  | Tested            | Applicable Query Core options pass through. Accumulated streams support `reset`, `append`, and `replace` refetch modes.                                 |
| Mutation callbacks                                      | Tested            | Applicable mutation options pass through. Build native optimistic updates with the application's `QueryClient`.                                         |
| Cache reads, writes, prefetching, invalidation, and SSR | Tested            | Native `QueryClient` methods accept generated options and keys. Completed data dehydrates normally; open server streams use a cancelled first snapshot. |
| React Query                                             | Tested            | Generated options work with ordinary, infinite, suspense, prefetch, mutation, accumulated-stream, and live hooks.                                       |
| TanStack Router and Start                               | Tested            | Generated options work in loaders, server rendering, hydration, streams, and client navigation.                                                         |
| RPC transport, middleware, and client lifecycle         | Application-owned | Supply a ready flat RPC client and keep its `Scope` alive. The package does not construct a transport or add interceptors.                              |
| Providers, Devtools, persistence, broadcast, and policy | Application-owned | Configure these through TanStack Query. The package provides no wrapper or default policy.                                                              |
| Query-versus-mutation classification                    | Application-owned | Every unary leaf offers both builders because Effect RPC definitions do not label reads and writes.                                                     |
| Automatic invalidation                                  | Application-owned | Invalidate with generated prefix keys in application callbacks.                                                                                         |
| Direct RPC execution                                    | Application-owned | Call the ready RPC client directly; generated leaves remain limited to TanStack key and option builders.                                                |
| SSR error and Effect Cause serialization                | Application-owned | Failed queries are omitted from example dehydration and refetched in the browser. Applications choose any cross-realm error format.                     |
| Mutation cancellation                                   | Impossible        | TanStack mutation functions provide no query-style abort signal.                                                                                        |
| Asynchronous or Effect-returning key encoders           | Impossible        | TanStack requires cache identity synchronously when options are built.                                                                                  |
| Non-React framework integrations                        | Uncertified       | The options are framework-neutral; applications must check compatibility with their framework's Query adapter.                                          |

Read [Compatibility and Limits](/effect-rpc-query/reference/compatibility-and-limits/) for version,
module-format, payload, key-safety, and error-boundary details.

## Design influences

The API design draws on these projects:

- [tRPC's TanStack React Query integration](https://github.com/trpc/trpc/tree/main/packages/tanstack-react-query)
  derives TanStack-native option builders from a typed RPC surface.
- [Effect Query](https://github.com/voidhashcom/effect-query) runs Effect programs through TanStack
  Query and demonstrates Effect RPC integration.

This package builds directly on [Effect](https://github.com/Effect-TS/effect) RPC definitions and
[TanStack Query](https://github.com/TanStack/query). Its focused contract adds an eager RPC utility
tree, Schema-derived semantic keys, caller-owned RPC clients, and complete Effect Cause preservation.
