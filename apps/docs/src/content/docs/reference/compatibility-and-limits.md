---
title: Compatibility and Limits
description: Peer requirements, tested integrations, supported operations, and runtime limits.
---

## Requirements and tested integrations

Use ESM, ES2022, and TypeScript with `strict: true`. The package declares Effect and Query Core as peer dependencies. Each framework Query wrapper declares its own framework peer requirements.

| Component | Declared requirement | Exact versions checked |
| --- | --- | --- |
| Effect | Library peer: `>=4.1.4 <4.2.0` | Coordinated runtime, testing, and Node platform packages: `4.1.4` |
| Query Core | Library peer: `>=5.107.1 <6` | `5.107.1` |
| TypeScript | Public declarations: 5.9 through reviewed 7.1 beta, with `strict: true` | `5.9.3` and Effect-enhanced TSRS `0.25.0` (TypeScript `7.1.0-beta`) |
| React and React Query | Optional peers for `./react`: React `^18 \|\| ^19`, React Query `>=5.107.1 <6` | React `19.3.1`, React Query `5.107.1` |
| Vue and Vue Query | Vue Query peer: Vue `^2.6.0 \|\| ^3.3.0` | Vue `3.5.44`, Vue Query `5.107.1` |
| Solid and Solid Query | Solid Query peer: Solid `^1.6.0` | Solid `1.9.18`, Solid Query `5.107.1` |
| Svelte and Svelte Query | Svelte Query peer: Svelte `^5.25.0` | Svelte `5.57.3`, Svelte Query `6.4.1` |
| Angular and Angular Query experimental | Angular Query peers: `@angular/core` and `@angular/common` `>=16.0.0` | Angular `22.2.4`, Angular Query experimental `5.107.1` |

Keep your Effect packages on matching versions within the peer range. Keep your application and Query wrapper on one resolved Query Core version.

This site documents the package version shown in the header. Before 1.0, breaking changes, new features, and peer-range changes increment the minor version. Compatible fixes increment the patch version.

## Capability matrix

| Operation | RPC | HTTP |
| --- | --- | --- |
| Ordinary queries, pagination, mutations | Unary RPCs | Buffered endpoints without multipart, regardless of method |
| Accumulated and live streams | Streaming RPCs | One unambiguous SSE or NDJSON success without multipart |
| Buffered multipart uploads | Application-owned client and payload contract | Mutation-only, with `FormData` supplied by the application |
| Streaming request payloads, raw byte responses, and HTTP upgrades | Client transport contract | Omitted endpoints |
| Response metadata | Declared RPC result | Buffered decoded data with frozen status and header snapshots |
| Conditional reads | `skipToken` for input-bearing query builders | Same, including buffered metadata |
| Query cancellation | Signal forwarding and iterator cleanup | Same, with `fetch` able to abort the pending request |
| Mutation cancellation | Explicit application command | Explicit application operation |
| Keys and failures | `rpc` namespace, dotted paths, full Cause | `http` namespace, literal paths, full Cause and declaration identity |

Your application owns clients, providers, middleware, serialization, cache updates, and disposal. Pass the generated options to a QueryClient or your framework Query wrapper.

TanStack supplies an abort signal for queries. Mutations have no query abort signal. To cancel server work, define an explicit application command. For direct unary or buffered execution outside the cache, use `call` or `effect` on the leaf.

## Input and cache limits

For accumulated streams, set `maxChunks` to a positive safe integer or `"unbounded"`. You can set it on the call or through `configureUtils`.

Cache keys require strict JSON. Supply a synchronous [custom key encoder](/effect-api-query/guides/custom-key-encoders/) when a query input uses encoding services, redacted values, binary data, or multiple HTTP payload alternatives. Omit mutation-only multipart endpoints from `keyEncoders`.

Use a query-stable RPC Schema because key preparation and execution each construct the payload. Keep captured input unchanged while its options can run.

Buffered and live queries convert `undefined` to `null`. Mutations and accumulated streams keep `undefined`. See [inputs and query data](/effect-api-query/concepts/data-normalization/) for full normalization rules.

## Server rendering and errors

- Exclude failed queries from dehydration and let the browser refetch, or serialize a safe error value explicitly.
- Reserve an idle, unobserved key for a fresh [stream snapshot](/effect-api-query/guides/stream-snapshots/). The timeout limits the wait for data, and the helper still waits for local cleanup.
- Use [hydration codecs](/effect-api-query/guides/hydrate-query-views/) to serialize binary values, dates, and Schema classes.
- Call execution-error guards in the same JavaScript realm as the error because they use `instanceof`.
