---
title: Compatibility and Limits
description: Peer requirements, tested integrations, RPC and HTTP operations, cache identity, and runtime limits.
---

## Requirements and tested integrations

The package is ESM-only and targets ES2022. It declares Effect and Query Core as peers. Framework requirements come from the native Query wrappers. The table separates those declared requirements from the exact versions checked for this release. A wrapper's peer range can be broader than the combinations checked here.

| Component | Declared requirement | Exact versions checked |
| --- | --- | --- |
| Effect | Library peer: `4.0.4` | Runtime, testing, and Node platform packages: `4.0.4` |
| Query Core | Library peer: `>=5.103.1 <6` | `5.104.2` |
| TypeScript | Public declarations: 5.9 or newer, with `strict: true` | `5.9.3` and `7.0.2` |
| React and React Query | React Query peer: React `^18 \|\| ^19` | React `19.3.0`, React Query `5.104.2` |
| Vue and Vue Query | Vue Query peer: Vue `^2.6.0 \|\| ^3.3.0` | Vue `3.5.43`, Vue Query `5.104.2` |
| Solid and Solid Query | Solid Query peer: Solid `^1.6.0` | Solid `1.9.15`, Solid Query `5.104.2` |
| Svelte and Svelte Query | Svelte Query peer: Svelte `^5.25.0` | Svelte `5.57.1`, Svelte Query `6.3.0` |
| Angular and Angular Query experimental | Angular Query peers: `@angular/core` and `@angular/common` `>=16.0.0` | Angular `22.2.1`, Angular Query experimental `5.104.2` |

All listed Query wrappers resolve Query Core `5.104.2` in the checked combinations. Svelte Query `6.3.0` declares Core `5.104.0`; its checked combination uses a package-manager override to resolve `5.104.2`. Keep the application's Query Core and its wrapper's Core dependency on one resolved version.

Vue Query also declares an optional `@vue/composition-api` peer of `^1.1.2` for Vue 2.6 applications. The checked Vue combination uses Vue 3.

The application examples also use TanStack Start `1.169.1`, TanStack Router `1.170.44`, and Router SSR Query `1.167.3`.

The stable Effect release contains unstable RPC and HTTP API modules. The application's Effect packages must stay coordinated with the exact peer. See [Compatibility and Stability](/effect-api-query/getting-started/compatibility-and-stability/).

Generated Core options support native reactive accessors and retain each framework's hook overloads. The Vue, Solid, Svelte, and Angular combinations above are checked for native hook inference in TypeScript consumer modules. These checks use both listed TypeScript versions. Framework component compilers and application builds have their own tooling requirements. See [Vue Query](/effect-api-query/guides/vue-query/), [Solid Query](/effect-api-query/guides/solid-query/), [Svelte Query](/effect-api-query/guides/svelte-query/), and [Angular Query](/effect-api-query/guides/angular-query/) for option rebuilding, compiler resolution, hook overloads, and resource ownership.

[Package metadata](https://github.com/ueberBrot/effect-api-query/blob/main/package.json) declares library peers. The [workspace catalog](https://github.com/ueberBrot/effect-api-query/blob/main/pnpm-workspace.yaml) pins the Effect release and example dependencies. The [framework consumers](https://github.com/ueberBrot/effect-api-query/tree/main/tests/framework-consumers) pin the other native integrations and Core alignment.

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

Accumulated stream keys and options require a positive `maxChunks` bound or `"unbounded"`. A configured tree, branch, or leaf can supply this choice through `streamed.policy`.

Cache identity must be strict JSON. Public canonical payload slots are typed as `unknown`; generated key helpers retain typed data and errors. For endpoints with query support, encoding services, redacted values, and multiple HTTP payload alternatives require safe [custom encoders](/effect-api-query/guides/custom-key-encoders/). Binary query input needs a JSON-safe projection. Multipart mutation-only endpoints require no encoder and reject encoder entries. Encoders are synchronous. Asynchronous and Effect-returning encoders are unsupported.

RPC payload Schemas must be query-stable because preparation and ready-client execution construct the payload separately. HTTP builders accept decoded request input without RPC construction. Captured input must remain unchanged while its options can run. Frozen keys do not freeze arbitrary input or decoded data.

Buffered queries and live emissions normalize successful `undefined` to `null`. Accumulated stream elements and mutation results preserve it. [Data Normalization](/effect-api-query/concepts/data-normalization/) explains payload construction, input ownership, and query data. [Performance and Bundling](/effect-api-query/reference/performance/) describes construction costs.

## Server rendering and errors

- The package does not serialize errors for SSR. Failed queries require an application error serializer, or exclusion from dehydration followed by a browser refetch.
- [fetchStreamSnapshot](/effect-api-query/guides/stream-snapshots/) captures an open stream before dehydration. A fresh capture exclusively owns an idle, unobserved exact query and settles after local iterator cleanup. Its timeout limits the wait for data. It does not limit finalizer duration or acknowledge remote cancellation.
- HTTP binary data and other domain values need an application serialization strategy.
- Both execution-error guards use `instanceof` and recognize errors from the same JavaScript realm.
