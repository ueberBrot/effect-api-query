---
title: Feature Support
description: Choose the RPC or HTTP adapter and find its supported TanStack Query features.
---

`effect-api-query` builds TanStack Query options and cache keys from Effect RPC groups and HttpApi definitions.
Import `createRpcQueryUtils` for RPC or `createHttpApiQueryUtils` for HTTP from the package root.

Use your native Effect declarations and ready clients. Effect and your application own the server, transport, authentication, and resource lifetime.
This package builds the keys, functions, and options that TanStack Query consumes.

## Pick the operation

| Contract                               | Available views                              | Details                                                                                                                    |
| -------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Unary RPC / buffered nonmultipart HTTP | Query, infinite query, mutation              | [RPC Builders](/effect-api-query/reference/generated-builders/), [HTTP Factory](/effect-api-query/reference/http-factory/) |
| Buffered nonmultipart HTTP             | Separate decoded data/status/header metadata | [ETag workflow](/effect-api-query/guides/http-metadata/#update-with-an-etag)                                               |
| Buffered multipart HTTP                | Mutation with explicit `FormData`            | [Upload](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file)                                               |
| RPC stream / unambiguous HTTP SSE      | Accumulated history or latest value          | [Choose Stream History](/effect-api-query/guides/choose-stream-history/)                                                   |

Use queries for cached reads and mutations for commands. Writes refresh reads only when your application invalidates the affected queries.
The package omits raw byte streams, mixed buffered and SSE successes, streaming multipart endpoints, and raw-response modes.
It also omits SSE endpoints with multipart payloads.
See [Compatibility and Limits](/effect-api-query/reference/compatibility-and-limits/).

## Plan application ownership

Before constructing utilities, configure transport and authentication, acquire the ready client, and create any required runtime.
Keep those resources alive while queries and mutations use them.
Your application configures TanStack providers, Devtools, persistence, broadcasting, and cache defaults.

If client configuration changes the returned data, include a safe user or tenant identity in `keyPrefix`.
Keep credentials out of keys. See [semantic keys](/effect-api-query/concepts/semantic-keys/)
and [client lifecycle](/effect-api-query/concepts/client-lifecycle/).

Start with the [RPC Quick Start](/effect-api-query/getting-started/quick-start/) or
[HTTP Quick Start](/effect-api-query/getting-started/http-quick-start/).
