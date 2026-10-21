---
title: Compatibility and Limits
description: Supported versions, RPC and HTTP operations, cache identity, and runtime limits.
---

## Supported integrations

The package declares one exact Effect peer and Query Core `>=5.103.1 <6`. It is ESM-only and targets ES2022. The published TypeScript contract requires `strict: true`. The repository uses these versions:

| Integration | Versions |
| --- | --- |
| Effect runtime, testing, and Node platform packages | 4.0.4 |
| Query Core and React Query | 5.104.2, with matching versions |
| Published TypeScript contract | 5.9.3 and 7.0.2 |
| React | 19.3.0 |
| TanStack Start | 1.169.1 |
| TanStack Router and Router SSR Query | 1.170.44 and 1.167.3, respectively |

The stable Effect release contains unstable RPC and HTTP API modules. The application's Effect packages must stay coordinated with the exact peer. See [Compatibility and Stability](/effect-api-query/getting-started/compatibility-and-stability/).

Generated Core options work with native reactive accessors. See [Vue Query](/effect-api-query/guides/vue-query/), [Solid Query](/effect-api-query/guides/solid-query/), [Svelte Query](/effect-api-query/guides/svelte-query/), and [Angular Query](/effect-api-query/guides/angular-query/) for option rebuilding, compiler resolution, hook overloads, and resource ownership.

[Package metadata](https://github.com/ueberBrot/effect-api-query/blob/main/package.json) declares peer ranges. The [workspace catalog](https://github.com/ueberBrot/effect-api-query/blob/main/pnpm-workspace.yaml) pins the Effect release and example dependencies.

## Capability matrix

| Operation | RPC | HTTP |
| --- | --- | --- |
| Ordinary queries, pagination, mutations | Unary RPCs | Buffered endpoints without multipart, regardless of method |
| Accumulated and live streams | Streaming RPCs | One unambiguous SSE success without multipart |
| Buffered multipart uploads | Client and payload contract owned by the application | Mutation-only, with `FormData` supplied by the application |
| Streaming multipart and raw byte streams | Client transport contract | Omitted endpoints |
| Response metadata | Declared RPC result | Buffered decoded data with plain snapshots of status and headers |
| Conditional reads | `skipToken` for input-bearing query builders | Same, including buffered metadata |
| Query cancellation | Signal forwarding and iterator cleanup, with server interruption determined by transport | Same, with fetch able to abort the pending request |
| Mutation cancellation | Explicit application command | Explicit application operation |
| Keys and failures | `rpc` namespace, dotted paths, full Cause | `http` namespace, literal paths, full Cause and declaration identity |

Clients, authentication, middleware, residual services, framework providers, host routes, SSR, serialization, mutation invalidation, and disposal belong to the application. The generated Core options work with native framework wrappers. The framework guides describe their accessors and inference limits.

The package executes calls through the ready client. TanStack provides query cancellation signals but has no corresponding mutation signal for the adapter to forward. Client middleware and transport construction control request interception. Observable server cancellation requires an explicit domain operation. Compensation is a separate operation.

The [examples](/effect-api-query/examples/) provide complete integrations. Streaming RPC builders use TanStack's experimental `streamedQuery` helper. Calls that do not need TanStack Query can use the ready client directly.

[Browser and worker hosts](/effect-api-query/reference/browser-and-worker-hosts/) explains ready-client ownership and the worker transport boundary.

WebSocket clients support unary calls, both stream views, and application-owned connection replacement. The [WebSocket recipe](/effect-api-query/guides/websocket-clients/) describes buffering and chunk-decoding limits. Local cancellation alone does not prove remote completion.

[External HTTP clients](/effect-api-query/reference/external-http-clients/) describes generated OpenAPI consumption with `openapi-fetch` and `openapi-typescript`. Encoded DTOs, multipart serialization, and raw SSE access retain their own contracts. The external client does not replace a ready Effect client.

## Input and cache limits

Cache identity must be strict JSON. For endpoints with query support, encoding services, redacted values, and multiple HTTP payload alternatives require safe [custom encoders](/effect-api-query/guides/custom-key-encoders/). Binary query input needs a JSON-safe projection. Multipart mutation-only endpoints require no encoder and reject encoder entries. Encoders are synchronous. Asynchronous and Effect-returning encoders are unsupported.

RPC payload Schemas must be query-stable because preparation and ready-client execution construct the payload separately. HTTP builders accept decoded request input without RPC construction. Captured input must remain unchanged while its options can run. Frozen keys do not freeze arbitrary input or decoded data.

Buffered queries and live emissions normalize successful `undefined` to `null`. Accumulated stream elements and mutation results preserve it. [Data Normalization](/effect-api-query/concepts/data-normalization/) explains payload construction, input ownership, and query data. [Performance and Bundling](/effect-api-query/reference/performance/) describes construction costs.

## Server rendering and errors

- The package does not serialize errors for SSR. Failed queries require an application error serializer, or exclusion from dehydration followed by a browser refetch.
- [fetchStreamSnapshot](/effect-api-query/guides/stream-snapshots/) captures an open stream before dehydration. A fresh capture exclusively owns an idle, unobserved exact query and settles after local iterator cleanup. Its timeout limits the wait for data. It does not limit finalizer duration or acknowledge remote cancellation.
- HTTP binary data and other domain values need an application serialization strategy.
- Both execution-error guards use `instanceof` and recognize errors from the same JavaScript realm.
