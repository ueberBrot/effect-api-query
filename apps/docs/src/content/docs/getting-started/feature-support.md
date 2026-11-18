---
title: Feature Support
description: Choose the RPC or HTTP adapter and find its supported TanStack Query features.
---

Use `createRpcQueryUtils` with an Effect RPC group or `createHttpApiQueryUtils` with an HttpApi declaration. Both factories take a client your app already acquired.

## Pick the operation

| Contract | Available views | Details |
| --- | --- | --- |
| Unary RPC / buffered nonmultipart HTTP | Query, infinite query, mutation | [RPC Builders](/effect-api-query/reference/generated-builders/), [HTTP Factory](/effect-api-query/reference/http-factory/) |
| Buffered nonmultipart HTTP | Separate decoded data/status/header metadata | [ETag workflow](/effect-api-query/guides/http-metadata/#update-with-an-etag) |
| Buffered multipart HTTP | Mutation with explicit `FormData` | [Upload](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file) |
| RPC stream / unambiguous HTTP SSE or NDJSON | Accumulated history or latest value | [Choose Stream History](/effect-api-query/guides/choose-stream-history/) |

Use queries for cached reads and mutations for writes. After a write, update affected entries or invalidate them to mark them stale. Active queries refetch by default. See [compatibility and limits](/effect-api-query/reference/compatibility-and-limits/) for unsupported HTTP shapes.

## Plan application ownership

Keep your Effect client and runtime alive while requests use them. See [client lifecycle](/effect-api-query/concepts/client-lifecycle/) for cleanup.

If results vary by user or tenant, include a safe identifier in `keyPrefix`. Keep credentials out of keys. See [semantic keys](/effect-api-query/concepts/semantic-keys/).

Start with the [RPC Quick Start](/effect-api-query/getting-started/quick-start/) or [HTTP Quick Start](/effect-api-query/getting-started/http-quick-start/).
