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

The [capability matrix](/effect-api-query/reference/compatibility-and-limits/#capability-matrix)
compares RPC and HTTP support. It lists generated features, tested integrations, application
responsibilities, deferred operations, and missing upstream integration points.

## Pick the operation

Use ordinary queries for cached reads, infinite queries for pagination, and mutations for commands.
Unary RPCs and buffered HTTP endpoints without multipart provide all three builders. Buffered
multipart HTTP endpoints provide mutations only. Writes refresh cached reads only when your
application invalidates the affected keys.

Query-enabled buffered HTTP endpoints also expose `metadataOptions` for decoded data, status, and
raw response headers with separate cache identity. See
[Update with an ETag](/effect-api-query/guides/http-queries-and-mutations/#update-with-an-etag).

RPC streams and unambiguous HTTP SSE endpoints have `streamedOptions` to accumulate values and
`liveOptions` to retain the latest value. Buffered multipart HTTP uploads accept explicit `FormData`
through `mutationOptions`;
see [upload a file](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file).
Raw byte streams, mixed buffered/SSE successes, streaming multipart, and raw-response modes remain
omitted. SSE endpoints with buffered multipart payloads are also omitted. See
[HTTP streams](/effect-api-query/guides/http-queries-and-mutations/#retain-sse-events).

## Plan application ownership

Configure transport and authentication, acquire the ready client, and create any required runtime
before constructing utilities. Keep those resources alive while queries and mutations use them. Configure
TanStack providers, Devtools, persistence, broadcasting, and cache defaults in your application.

Include a safe user or tenant identity in `keyPrefix` whenever client configuration changes the
returned data. Keep credentials out of keys. See [semantic keys](/effect-api-query/concepts/semantic-keys/)
and [client lifecycle](/effect-api-query/concepts/client-lifecycle/).

Start with the [RPC tutorial](/effect-api-query/getting-started/quick-start/) or
[HTTP tutorial](/effect-api-query/getting-started/http-quick-start/), then use the shared guides for
[conditional queries](/effect-api-query/guides/conditional-queries/),
[cache management](/effect-api-query/guides/cache-management/), and
[cancellation](/effect-api-query/guides/cancellation/).

For application workflows, use [Query Defaults](/effect-api-query/guides/query-defaults/),
[Optimistic User Writes](/effect-api-query/guides/optimistic-writes/),
[Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/), and
[Refresh from Domain Events](/effect-api-query/guides/refresh-from-events/).
For server data, use [Stream Snapshots](/effect-api-query/guides/stream-snapshots/) and
[Hydrate Query Views](/effect-api-query/guides/hydrate-query-views/). These recipes retain
application ownership of policies, codecs, persistence, and disposal.
