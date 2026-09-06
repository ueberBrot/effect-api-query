---
title: Compatibility and Limits
description: Supported versions, RPC and HTTP operations, cache identity, and runtime limits.
---

## Supported integrations

- Effect `4.0.0-rc.112`.
- TanStack Query Core `>=5.102.0 <6`.
- Query Core, React Query, TanStack Router loaders, and TanStack Start.
- TypeScript 5.9 or newer with `strict: true`.
- The package is ESM-only and targets ES2022.

## Operations

- Unary RPCs expose ordinary query, infinite-query, and mutation builders. Streaming RPCs expose
  accumulated-stream and live-query builders.
- Infinite queries map each TanStack `pageParam` to one unary RPC payload. Streaming builders adapt
  an Effect RPC stream through TanStack's experimental `streamedQuery` helper.
- Buffered HTTP endpoints expose ordinary query and mutation builders. Any streaming success or
  multipart request alternative omits the endpoint. See the [HTTP factory](/effect-rpc-query/reference/http-factory/).
- Conditional RPC queries accept `skipToken`. HTTP builders require complete request input and do not accept it.
- Use the ready client directly for calls that do not need TanStack Query.

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
