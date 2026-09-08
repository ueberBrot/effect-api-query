---
title: Feature Support
description: Choose the RPC or HTTP adapter and find its supported TanStack Query features.
---

`effect-api-query` creates TanStack Query options and cache keys from Effect RPC groups and HttpApi
definitions. Use `createRpcQueryUtils` for RPC and `createHttpApiQueryUtils` for HTTP, both imported
from the package root.

The [capability matrix](/effect-api-query/reference/compatibility-and-limits/#capability-matrix)
compares RPC and HTTP support. It lists generated features, tested integrations, application
responsibilities, deferred operations, and missing upstream integration points.

## Pick the operation

Use ordinary queries for cached reads, infinite queries for pagination, and mutations for commands.
Both adapters generate these builders for every retained unary operation, so choose the one that
fits each call. Writes refresh cached reads only when your application invalidates the affected keys.

RPC streams also have `streamedOptions` to accumulate values and `liveOptions` to retain the latest
value. HTTP streams, multipart uploads, and raw-response modes are deferred. The factory omits an
HTTP endpoint from the generated utility tree if it has any streaming success or multipart request
alternative.

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
