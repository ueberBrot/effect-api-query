---
title: Feature Support
description: Choose the RPC or HTTP adapter and find its supported TanStack Query features.
---

`effect-api-query` creates TanStack Query options and cache keys from Effect RPC groups and HttpApi
definitions. Use `createRpcQueryUtils` for RPC and `createHttpApiQueryUtils` for HTTP, both imported
from the package root.

Keep your native Effect declarations and ready clients. Effect and your application own the
server, transport, authentication, and resource lifetime; this package derives the Query-facing
keys, functions, and options.

## Pick the operation

| Contract                               | Available views                              | Details                                                                                                                    |
| -------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Unary RPC / buffered nonmultipart HTTP | Query, infinite query, mutation              | [RPC Builders](/effect-api-query/reference/generated-builders/), [HTTP Factory](/effect-api-query/reference/http-factory/) |
| Buffered nonmultipart HTTP             | Separate decoded data/status/header metadata | [ETag workflow](/effect-api-query/guides/http-queries-and-mutations/#update-with-an-etag)                                  |
| Buffered multipart HTTP                | Mutation with explicit `FormData`            | [Upload](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file)                                               |
| RPC stream / unambiguous HTTP SSE      | Accumulated history or latest value          | [Choose Stream History](/effect-api-query/guides/choose-stream-history/)                                                   |

Use queries for cached reads and mutations for commands; writes refresh reads only when the
application invalidates them. Raw byte streams, mixed buffered/SSE successes, streaming
multipart and raw-response modes are omitted, as are SSE endpoints with multipart payloads.
See [Compatibility and Limits](/effect-api-query/reference/compatibility-and-limits/).

## Plan application ownership

Configure transport and authentication, acquire the ready client, and create any required runtime
before constructing utilities. Keep those resources alive while queries and mutations use them. Configure
TanStack providers, Devtools, persistence, broadcasting, and cache defaults in your application.

Include a safe user or tenant identity in `keyPrefix` whenever client configuration changes the
returned data. Keep credentials out of keys. See [semantic keys](/effect-api-query/concepts/semantic-keys/)
and [client lifecycle](/effect-api-query/concepts/client-lifecycle/).

Start with the [RPC Quick Start](/effect-api-query/getting-started/quick-start/) or
[HTTP Quick Start](/effect-api-query/getting-started/http-quick-start/).
