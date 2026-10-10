---
title: Compatibility and Limits
description: Supported versions, RPC and HTTP operations, cache identity, and runtime limits.
---

## Supported integrations

See [Performance and Bundling](/effect-api-query/reference/performance/) for construction costs,
source measurements, and adapter versus application bundles.

The package declares one exact Effect peer and Query Core `>=5.103.1 <6`. It is ESM-only and
targets ES2022. Use TypeScript with `strict: true`. The repository uses these versions:

| Integration                                         | Versions                           |
| --------------------------------------------------- | ---------------------------------- |
| Effect runtime, testing, and Node platform packages | 4.0.0                              |
| Query Core and React Query                          | 5.104.0, with matching versions    |
| Published TypeScript contract                       | 5.9.3 and 7.0.2                    |
| React                                               | 19.3.0                             |
| TanStack Start                                      | 1.168.60                           |
| TanStack Router and Router SSR Query                | 1.170.41 and 1.167.3, respectively |

The stable Effect release contains unstable RPC and HTTP API modules. Keep the application's
Effect packages coordinated with the exact peer; see
[Compatibility and Stability](/effect-api-query/getting-started/compatibility-and-stability/).

Use native reactive accessors with generated Core options. See
[Svelte and Angular](/effect-api-query/guides/svelte-and-angular/) and
[Vue and Solid Query](/effect-api-query/guides/vue-and-solid/) for option rebuilding,
compiler resolution, hook overloads, and resource ownership.

Consult [package metadata](https://github.com/ueberBrot/effect-api-query/blob/main/package.json) for
peer ranges and the [workspace catalog](https://github.com/ueberBrot/effect-api-query/blob/main/pnpm-workspace.yaml)
for the pinned Effect release and example dependencies.

## Capability matrix

**Generated** means the package supplies the typed builders and runtime behavior. **Tested** means
a public-contract fixture or executable example covers the integration. **Application-owned** means your application
supplies the client, policy, or lifecycle. **Deferred** means the adapter does not expose it.

| Capability                                        | RPC                                                                                                      | HTTP                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Ordinary queries and mutations                    | Generated for unary RPCs                                                                                 | Generated for buffered endpoints without multipart, regardless of method                     |
| Pagination                                        | Generated `infiniteOptions`; pages map to payloads                                                       | Generated for buffered endpoints without multipart; pages map to decoded requests            |
| Accumulated streams and live queries              | Generated for streaming RPCs; tested cancellation and SSR snapshots                                      | Generated for unambiguous SSE successes without multipart; tested failures and cleanup       |
| Buffered multipart uploads                        | Application-owned transport and payload contract                                                         | Generated mutation-only builders; application supplies `FormData`                            |
| Streaming multipart                               | Application-owned transport and payload contract                                                         | Deferred; any streaming multipart request alternative omits the endpoint                     |
| Raw HTTP response modes                           | Outside the RPC contract                                                                                 | Raw responses omitted; metadata views retain decoded data and plain status/header snapshots  |
| Conditional queries                               | Generated `skipToken` support for input-bearing queries                                                  | Generated `skipToken` support for input-bearing queries                                      |
| Cache keys and invalidation prefixes              | Generated `rpc` namespace and dotted tag paths                                                           | Generated `http` namespace, API identifier, and literal projected paths                      |
| Failure inspection                                | Generated wrapper preserves the failed Exit Cause                                                        | Generated wrapper preserves the failed Exit Cause and declaration identity                   |
| Query cancellation                                | Generated signal forwarding and stream iterator cleanup; transport support is application-owned          | Generated signal forwarding; fetch abort is tested                                           |
| Mutation cancellation                             | No upstream TanStack mutation abort signal; explicit cancellable command is application-owned and tested | No upstream TanStack mutation abort signal; domain cancellation is application-owned         |
| Authentication, middleware, and residual services | Application-owned ready client and runner                                                                | Application-owned ready client and runner                                                    |
| React hooks and QueryClient                       | Tested public types and Vite React example                                                               | Tested public types and Vite React example                                                   |
| Svelte and Angular browser components             | Native reactive accessors for generated queries and streams; application-owned lifecycle                 | Native reactive accessors for buffered, metadata, and SSE views; application-owned lifecycle |
| Vue and Solid Query                               | Native reactive accessors; application-owned lifecycle                                                   | Native reactive accessors; application-owned lifecycle                                       |
| SSR and hydration                                 | Application-owned; tested Start route loading and stream snapshots                                       | Application-owned; tested Start SSR, hydration, failed-query refetch, and request isolation  |
| Host routes                                       | Application-owned; tested standalone server and Start `/rpc`                                             | Application-owned; tested standalone server and Start `/api/$`                               |
| Cache serialization and mutation invalidation     | Application-owned                                                                                        | Application-owned                                                                            |

The package executes calls through the ready client. TanStack provides query cancellation
signals but has no corresponding mutation signal for the adapter to forward. Configure request
interception through client middleware and transport construction. Use an explicit domain
operation when server cancellation must be observable; compensation is a separate operation.

The [public RPC consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/public-contract.ts),
[public HTTP consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/http-contract.ts),
and [executable examples](/effect-api-query/examples/) establish the tested scope. Streaming RPC
builders use TanStack's experimental `streamedQuery` helper. Use the ready client directly for
calls that do not need TanStack Query.

[Browser and worker hosts](/effect-api-query/reference/browser-and-worker-hosts/) explains
ready-client ownership and the worker transport boundary.

WebSocket clients support unary calls, both stream views, and application-owned connection
replacement. Follow the [WebSocket recipe](/effect-api-query/guides/websocket-clients/) for
buffering and chunk-decoding limits. Local cancellation alone does not prove remote completion.

[External HTTP clients](/effect-api-query/reference/external-http-clients/) covers generated
OpenAPI consumption with `openapi-fetch` and `openapi-typescript`. Encoded DTOs,
multipart serialization, and raw SSE access retain their own contracts; the external client does
not replace a ready Effect client.

With Effect 4.0.0, single-element arrays in GET and form-urlencoded payloads can fail server
decoding. Array query parameters and JSON array responses retain their usual representation.

## Runtime and cache behavior

- The caller owns RPC or HTTP client acquisition, `Scope`, transport, Query Client, providers, router, SSR,
  hydration, and disposal.
- The package provides no framework adapter, provider, or Node-specific integration helper.
- Query cancellation reaches the runner as an `AbortSignal`; stream cancellation closes the
  AsyncIterator. Transport-level interruption depends on the client integration.
- Mutation cancellation is outside the generated API.
- Mutations do not invalidate queries automatically. Applications choose the affected key prefix.
- RPC and HTTP query successes that may be `undefined` become `null` because TanStack Query rejects
  `undefined` query data. Live emissions follow this rule; accumulated stream elements and mutation
  results keep their original success types.
- Cache identity must be strict JSON. Encoding services, redacted values, and multiple HTTP payload
  alternatives require safe custom encoders for endpoints with query support. Binary query input needs
  a JSON-safe projection. Multipart mutation-only endpoints require no encoder and reject encoder entries.
- Key encoders are synchronous; asynchronous and Effect-returning encoders are unsupported.
- RPC payload Schemas must be query-stable because key preparation and ready-client execution
  construct the payload separately. HTTP builders accept decoded request input without RPC construction.
- Query options retain execution input. Keep captured values unchanged while they can run; immutable
  keys do not clone or freeze arbitrary input or decoded data. See
  [Data Normalization](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged).

## Server rendering and errors

- The package does not serialize errors for SSR. Omit failed queries from dehydration and refetch
  them in the browser, or provide your own error serializer.
- Await [fetchStreamSnapshot](/effect-api-query/guides/stream-snapshots/) to capture an open stream
  before dehydration. A fresh capture exclusively owns an idle, unobserved exact query and awaits
  local iterator cleanup. Its timeout limits the wait for data, not finalizer duration or remote
  cancellation acknowledgement.
- HTTP binary data and other domain values need an application serialization strategy.
- Both execution-error guards use `instanceof` and recognize errors from the same JavaScript realm.
