---
title: Compatibility and Limits
description: Supported versions, RPC and HTTP operations, cache identity, and runtime limits.
---

## Supported integrations

The package targets Effect 4 and TanStack Query Core 5, with React Query and TanStack Start
integrations checked in this repository. It is ESM-only and targets ES2022. Use TypeScript with
`strict: true`.

Consult [package metadata](https://github.com/ueberBrot/effect-api-query/blob/main/package.json) for
peer ranges and the [workspace catalog](https://github.com/ueberBrot/effect-api-query/blob/main/pnpm-workspace.yaml)
for the pinned Effect prerelease and framework versions. The
[packed consumer verifier](https://github.com/ueberBrot/effect-api-query/blob/main/scripts/verify-packed-consumer.mts)
defines the compiler and peer combinations tested against the packaged library.

Both factories are checked with TypeScript 5.9 and the repository compiler, using the minimum
supported Query Core version and the version installed for development. Isolated consumers install the tarball with their own peers and
verify runtime exports, peer identity, and private-subpath rejection. Separate RPC and HTTP
contracts each exercise roughly 250 operations; compiler diagnostics record their combined cost
without imposing a timing threshold.

## Capability matrix

**Generated** means the package supplies the typed builders and runtime behavior. **Tested** means
an executable consumer verifies the integration. **Application-owned** means your application
supplies the client, policy, or lifecycle. **Deferred** means the adapter does not expose it.

| Capability                                        | RPC                                                                                                      | HTTP                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Ordinary queries and mutations                    | Generated for unary RPCs                                                                                 | Generated for buffered endpoints, regardless of method                                      |
| Pagination                                        | Generated `infiniteOptions`; pages map to payloads                                                       | Generated `infiniteOptions`; pages map to complete decoded requests                         |
| Accumulated streams and live queries              | Generated for streaming RPCs; tested cancellation and SSR snapshots                                      | Deferred; any streaming success alternative omits the endpoint                              |
| Multipart uploads                                 | Application-owned transport and payload contract                                                         | Deferred; any multipart request alternative omits the endpoint                              |
| Raw HTTP response modes                           | Outside the RPC contract                                                                                 | Deferred; generated calls force decoded-only responses                                      |
| Conditional queries                               | Generated `skipToken` support for input-bearing queries                                                  | Generated `skipToken` support for input-bearing queries                                     |
| Cache keys and invalidation prefixes              | Generated `rpc` namespace and dotted tag paths                                                           | Generated `http` namespace, API identifier, and literal projected paths                     |
| Failure inspection                                | Generated wrapper preserves the failed Exit Cause                                                        | Generated wrapper preserves the failed Exit Cause and declaration identity                  |
| Query cancellation                                | Generated signal forwarding and stream iterator cleanup; transport support is application-owned          | Generated signal forwarding; fetch abort is tested                                          |
| Mutation cancellation                             | No upstream TanStack mutation abort signal; explicit cancellable command is application-owned and tested | No upstream TanStack mutation abort signal; domain cancellation is application-owned        |
| Authentication, middleware, and residual services | Application-owned ready client and runner                                                                | Application-owned ready client and runner                                                   |
| React hooks and QueryClient                       | Tested public consumers and Vite React example                                                           | Tested public consumers and Vite React example                                              |
| SSR and hydration                                 | Application-owned; tested Start route loading and stream snapshots                                       | Application-owned; tested Start SSR, hydration, failed-query refetch, and request isolation |
| Host routes                                       | Application-owned; tested standalone server and Start `/rpc`                                             | Application-owned; tested standalone server and Start `/api/$`                              |
| Cache serialization and mutation invalidation     | Application-owned                                                                                        | Application-owned                                                                           |

The package executes calls through the ready client. TanStack provides query cancellation
signals but has no corresponding mutation signal for the adapter to forward. Configure request
interception through client middleware and transport construction. Use an explicit domain
operation when server cancellation must be observable; compensation is a separate operation.

The [public RPC consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/public-contract.ts),
[public HTTP consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/http-contract.ts),
and [executable examples](/effect-api-query/examples/) establish the tested scope. Streaming RPC
builders use TanStack's experimental `streamedQuery` helper. Use the ready client directly for
calls that do not need TanStack Query.

## Runtime and cache behavior

- The caller owns RPC or HTTP client acquisition, `Scope`, transport, Query Client, providers, router, SSR,
  hydration, and disposal.
- The package provides no framework adapter, provider, or Node-specific integration helper.
- Query cancellation reaches the runner as an `AbortSignal`; stream cancellation closes the
  AsyncIterator. Transport-level interruption depends on the client integration.
- Mutation cancellation is outside the generated API.
- Mutations do not invalidate queries automatically. Applications choose the affected key prefix.
- RPC and HTTP query successes that may be `undefined` become `null` because TanStack Query rejects
  `undefined` query data. Mutation results keep their original success type.
- Cache identity must be strict JSON. Encoding services, redacted values, and multiple HTTP payload
  alternatives require safe custom encoders. Binary request input needs a JSON-safe projection.
- Key encoders are synchronous; asynchronous and Effect-returning encoders are unsupported.
- RPC payload Schemas must be query-stable because key preparation and ready-client execution
  construct the payload separately. HTTP builders accept decoded request input without RPC construction.

## Server rendering and errors

- The package does not serialize errors for SSR. Omit failed queries from dehydration and refetch
  them in the browser, or provide your own error serializer.
- Completed stream data dehydrates normally. An open stream must be cancelled after its first
  successful server snapshot before route loading and dehydration can finish.
- HTTP binary data and other domain values need an application serialization strategy.
- Both execution-error guards use `instanceof` and recognize errors from the same JavaScript realm.
