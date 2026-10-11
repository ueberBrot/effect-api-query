---
title: Generated Utility Model
description: Understand the contract, input, data, error, and cache identity carried by generated leaves.
---

A factory combines an Effect declaration with its ready client and a caller-supplied key prefix.
It eagerly builds an immutable utility tree. Branches represent declaration namespaces;
leaves represent RPCs or supported HTTP endpoints. Each leaf supplies the builders for the views
its contract supports.

## What a generated leaf carries

| Part              | Contract                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Input             | RPC payload constructor input or the complete decoded HTTP request                         |
| Query data        | Decoded data for the selected cache view, before an observer's `select`                    |
| Execution failure | Declaration identity plus the complete Effect Cause from a failed Exit                     |
| Cache identity    | Caller prefix, adapter/declaration path, view, canonical input, and applicable view policy |
| Options           | Generated key and function with the applicable native TanStack options                     |

Ordinary buffered reads cache decoded data. Infinite queries cache pages and page parameters.
Accumulated streamed queries cache emissions in order; live queries cache the latest value.
HTTP metadata caches decoded data beside immutable status and raw-header snapshots.
Mutation variables are execution input and do not become mutation-key identity.

See [Feature Support](/effect-api-query/getting-started/feature-support/) for supported contract
shapes. [RPC Utility Tree](/effect-api-query/concepts/rpc-utility-tree/) explains dotted tags;
[HTTP Utility Tree](/effect-api-query/concepts/http-utility-tree/) explains literal group and endpoint
identifiers and omitted endpoints.

## Keep input, cached data, and observer data distinct

RPC constructors can supply defaults before key preparation. HTTP builders accept decoded request
containers without RPC construction. Equivalent canonical input shares identity, while distinct
views remain separate. See [Inputs and Query Data](/effect-api-query/concepts/data-normalization/)
and [Semantic Keys](/effect-api-query/concepts/semantic-keys/).

An observer's `select` projects data without changing the cached representation. Buffered and
live `undefined` values become `null`; mutation results and accumulated stream elements retain
`undefined`. Infer these types from the generated leaf when extracting reusable application code.

## Ownership at the boundary

The package owns generated keys/functions, view identity, and adaptation of failed Effect Exits.
TanStack owns caching, observers, retries, invalidation, and framework hooks. The application owns
ready clients, runtimes, transport, authentication, providers, lifecycle, and relationships between
writes and reads.

The same generated options work in native QueryClient calls, framework hooks, and router loaders.
[Defaults and Policies](/effect-api-query/guides/query-defaults/) keeps reusable policy attached to
the leaf's types. [Integrations](/effect-api-query/integrations/) shows each consumer's wiring.
