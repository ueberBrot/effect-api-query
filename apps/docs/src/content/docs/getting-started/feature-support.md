---
title: Feature Support
description: Choose supported RPC and HTTP operations and plan your TanStack Query integration.
---

`effect-api-query` creates TanStack Query options and cache keys from Effect RPC groups and HttpApi
definitions. Choose a factory for your API:

| API definition            | Factory                   | Operations                                    |
| ------------------------- | ------------------------- | --------------------------------------------- |
| Unary RPC                 | `createRpcQueryUtils`     | Queries, infinite queries, and mutations      |
| Streaming RPC             | `createRpcQueryUtils`     | Accumulated streamed queries and live queries |
| Buffered HttpApi endpoint | `createHttpApiQueryUtils` | Queries and mutations                         |

An HTTP endpoint with any streaming success or multipart request alternative is omitted from the
utility tree. HTTP endpoints have no infinite or stream builders. See the
[HTTP guide](/effect-rpc-query/guides/http-queries-and-mutations/) for request input and examples.

## Use TanStack Query features

| Task                                            | How to use it                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Fetch and cache data                            | Pass generated `queryOptions` to Query Core or React Query.                          |
| Run a write                                     | Pass generated `mutationOptions` to a mutation observer or hook.                     |
| Pause an RPC query until input exists           | Use `input: skipToken` with a payload-bearing RPC query.                             |
| Load RPC pages                                  | Use `infiniteOptions`, mapping each page parameter to an RPC payload.                |
| Retain stream history                           | Use `streamedOptions`; set `maxChunks` to bound the retained elements.               |
| Show the latest stream value                    | Use `liveOptions`.                                                                   |
| Read, update, or invalidate cached data         | Pass generated keys to the corresponding `QueryClient` methods.                      |
| Configure retries, freshness, or data selection | Supply the applicable TanStack options to the builder.                               |
| Cancel a query                                  | Use `queryClient.cancelQueries`; the runner must forward its abort signal to Effect. |
| Prefetch or server-render data                  | Reuse generated options in loaders and dehydrate completed query data.               |

Generated options work with React Query hooks and TanStack Router loaders, including TanStack
Start. Configure other framework adapters through their native TanStack APIs; compatibility with
non-React adapters is not guaranteed.

## Configure application behavior

Create the ready client, transport, middleware, and runtime before constructing the utilities.
Keep their resources alive while queries and mutations use them. Configure providers, Devtools,
persistence, broadcasting, and cache defaults through TanStack Query.

Both query and mutation builders are available for every unary RPC and retained HTTP endpoint.
Choose the operation for each call; after a mutation, explicitly invalidate the affected query keys.
For execution without TanStack Query, call your ready client directly.

Keep authentication in your client configuration. If a tenant, user, or other client setting changes
the result, include its safe identity in `keyPrefix` to keep cache entries separate.

## Limits to account for

- Mutations receive no TanStack query abort signal. Long-running commands need an explicit
  [server cancellation operation](/effect-rpc-query/guides/cancellation/#cancel-a-command-while-its-mutation-is-pending).
- Key encoders must synchronously return strict JSON. Encoding services, redacted values, and
  ambiguous HTTP payload alternatives require [custom encoders](/effect-rpc-query/guides/custom-key-encoders/).
- Cancel an open server stream after capturing a successful snapshot before dehydration.
- Provide your own SSR error serialization, or omit failed queries from dehydration and refetch
  them in the browser.

See [Compatibility and Limits](/effect-rpc-query/reference/compatibility-and-limits/) for required
versions and the full input, cache, and runtime constraints.
