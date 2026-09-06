---
title: Compatibility and Limits
description: Supported runtimes, frameworks, RPC shapes, and stability boundaries.
---

## Supported integrations

- Effect `4.0.0-rc.112`.
- TanStack Query Core `>=5.102.0 <6`.
- Query Core, React Query, React Router loaders, and TanStack Start.
- TypeScript 5.9 and 7 with `strict: true`.
- The package is ESM-only and targets ES2022.

## Limits

- Unary RPCs expose ordinary query, infinite-query, and mutation builders. Streaming RPCs expose
  accumulated-stream and live-query builders.
- Infinite queries map each TanStack `pageParam` to one unary RPC payload. Streaming builders adapt
  an Effect RPC stream through TanStack's experimental `streamedQuery` helper.
- Leaves expose option and key builders, not a direct RPC execution helper.
- The caller owns RPC client acquisition, `Scope`, transport, Query Client, providers, router, SSR,
  hydration, and disposal.
- The package provides no framework adapter, provider, or Node-specific integration helper.
- Query cancellation reaches the runner as an `AbortSignal`; stream cancellation closes the
  AsyncIterator. Transport-level interruption depends on the client integration.
- Mutation cancellation is outside the generated API.
- Mutations do not invalidate queries automatically. Applications choose the affected key prefix.
- Query successes that may be `undefined` become `null` because TanStack Query rejects `undefined`
  query data. Mutation results keep their RPC success type.
- Cache identity must be strict JSON. Serviceful or redacted payloads need safe custom encoders.
- Key encoders are synchronous; asynchronous and Effect-returning encoders are unsupported.
- Payload Schemas must be query-stable because key preparation and ready-client execution construct
  the payload separately.
- The package does not serialize errors for SSR. Omit failed queries from dehydration and refetch
  them in the browser, or provide your own error serializer.
- Completed stream data dehydrates normally. An open stream must be cancelled after its first
  successful server snapshot before route loading and dehydration can finish.
- `isEffectRpcQueryError` uses `instanceof` and recognizes errors from the same JavaScript realm.
- CommonJS consumers are unsupported.
