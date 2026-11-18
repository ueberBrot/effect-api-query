---
title: Compatibility and Limits
description: Peer requirements, tested integrations, RPC and HTTP operations, cache identity, and runtime limits.
---

## Requirements and tested integrations

Use ESM and an environment that supports ES2022. The package declares Effect and Query Core as peers. Each Query wrapper declares its own framework requirements.

| Component | Declared requirement | Exact versions checked |
| --- | --- | --- |
| Effect | Library peer: `>=4.0.6 <4.2.0` | Coordinated runtime, testing, and Node platform packages: minimum `4.0.6`, 4.0 representative `4.0.7`, development `4.1.0`, 4.1 representative `4.1.2` |
| Query Core | Library peer: `>=5.104.4 <6` | `5.104.4` and `5.105.0` |
| TypeScript | Public declarations: 5.9 through reviewed 7.1 beta, with `strict: true` | `5.9.3` and Effect-enhanced TSRS `0.21.0` (TypeScript `7.1.0-beta`) |
| React and React Query | React Query peer: React `^18 \|\| ^19` | React `19.3.1`, React Query `5.105.0` |
| Vue and Vue Query | Vue Query peer: Vue `^2.6.0 \|\| ^3.3.0` | Vue `3.5.44`, Vue Query `5.105.0` |
| Solid and Solid Query | Solid Query peer: Solid `^1.6.0` | Solid `1.9.18`, Solid Query `5.105.0` |
| Svelte and Svelte Query | Svelte Query peer: Svelte `^5.25.0` | Svelte `5.57.3`, Svelte Query `6.3.6` |
| Angular and Angular Query experimental | Angular Query peers: `@angular/core` and `@angular/common` `>=16.0.0` | Angular `22.2.4`, Angular Query experimental `5.105.0` |

The tested wrappers resolve Query Core `5.105.0` without overrides. Keep your app and wrapper on one resolved Core version. The minimum `5.104.4` preserves a cached `null` first page parameter on refetch.

Vue Query declares an optional `@vue/composition-api` peer of `^1.1.2` for Vue 2.6. Tests use Vue 3.

The example apps use TanStack Start `1.169.4`, TanStack Router `1.170.46`, and Router SSR Query `1.167.3`.

The packed tests pair each listed Effect version with both Query Core versions. They check public types, execution, cancellation, and hydration with both listed compilers. Framework and app build checks use the development combination. Supported ranges include intermediate versions that CI does not test individually. See [compatibility and stability](/effect-api-query/getting-started/compatibility-and-stability/) for upgrade policy.

The Vue, Solid, Svelte, and Angular combinations check native hook inference in TypeScript consumer modules. Component compilers and app builds have their own requirements. See the [framework guides](/effect-api-query/integrations/) for accessors and tooling.

See the [package manifest](https://github.com/ueberBrot/effect-api-query/blob/main/package.json) for peers, the [workspace catalog](https://github.com/ueberBrot/effect-api-query/blob/main/pnpm-workspace.yaml) for development versions, and [framework consumers](https://github.com/ueberBrot/effect-api-query/tree/main/tests/framework-consumers) for test pins.

## Capability matrix

| Operation | RPC | HTTP |
| --- | --- | --- |
| Ordinary queries, pagination, mutations | Unary RPCs | Buffered endpoints without multipart, regardless of method |
| Accumulated and live streams | Streaming RPCs | One unambiguous SSE or NDJSON success without multipart |
| Buffered multipart uploads | Client and payload contract owned by the application | Mutation-only, with `FormData` supplied by the application |
| Streaming request payloads, raw byte responses, and HTTP upgrades | Client transport contract | Omitted endpoints |
| Response metadata | Declared RPC result | Buffered decoded data with plain snapshots of status and headers |
| Conditional reads | `skipToken` for input-bearing query builders | Same, including buffered metadata |
| Query cancellation | Signal forwarding and iterator cleanup, with server interruption determined by transport | Same, with fetch able to abort the pending request |
| Mutation cancellation | Explicit application command | Explicit application operation |
| Keys and failures | `rpc` namespace, dotted paths, full Cause | `http` namespace, literal paths, full Cause and declaration identity |

Configure clients, providers, middleware, serialization, cache updates, and disposal in your app. Use the generated options with the native wrapper for your framework.

TanStack supplies an abort signal for queries. Mutations have no matching signal. Use an explicit domain operation to cancel server work. Undo completed work through a separate compensation operation.

Stream queries publish through the public Query Core cache API. For complete integrations, see [examples](/effect-api-query/examples/). For calls without a cache, use the ready Effect client directly.

[Browser and worker hosts](/effect-api-query/reference/browser-and-worker-hosts/) explains ready-client ownership and the worker transport boundary.

Use the [WebSocket guide](/effect-api-query/guides/websocket-clients/) for buffering, chunk decoding, and connection replacement. Wait for a server acknowledgement if you need remote completion.

Use [external HTTP clients](/effect-api-query/reference/external-http-clients/) for OpenAPI DTOs, multipart uploads, and raw SSE access. Pass an Effect HttpApiClient to the factory.

## Input and cache limits

Set a positive safe-integer `maxChunks` or choose `"unbounded"` for accumulated streams. You can set it through `streamed.policy` on a tree, branch, or leaf.

Keys require strict JSON. Use generated builders for typed exact access. Supply a synchronous [custom encoder](/effect-api-query/guides/custom-key-encoders/) for query input with encoding services, redacted values, binary data, or multiple HTTP payload alternatives. Leave mutation-only multipart endpoints out of the encoder map.

Use a query-stable RPC Schema because query preparation and execution each construct the payload. HTTP uses decoded request parts. Keep captured input unchanged while its options can run.

Buffered and live queries turn `undefined` into `null`. Mutations and accumulated streams keep it. See [inputs and query data](/effect-api-query/concepts/data-normalization/) for the full rules and [performance](/effect-api-query/reference/performance/) for construction costs.

## Server rendering and errors

- Exclude failed queries from dehydration and let the browser refetch, or define a safe error serializer.
- Reserve an idle, unobserved key for a fresh [stream snapshot](/effect-api-query/guides/stream-snapshots/). The timeout limits the wait for data. The helper still awaits local cleanup.
- Define how to serialize binary and other rich values.
- Use the execution-error guards in the same JavaScript realm as the error because they use `instanceof`.
