---
title: Generated Utility Model
description: Understand the contract, input, data, error, and cache identity carried by generated leaves.
---

A factory combines an Effect declaration, its ready client, and a key prefix supplied by the caller. It builds the complete immutable utility tree when called. Branches represent declaration namespaces. Leaves represent RPCs or supported HTTP endpoints. Each leaf supplies builders for the views that its contract supports.

## What a generated leaf carries

| Part | Contract |
| --- | --- |
| Input | RPC payload constructor input or the complete decoded HTTP request |
| Query data | Decoded data for the selected cache view, before an observer's `select` |
| Execution failure | Declaration identity plus the complete Effect Cause from a failed Exit |
| Cache identity | Caller prefix, adapter and declaration path, view, canonical input, and applicable view policy |
| Options | Generated key and function with the applicable native TanStack options |

Ordinary buffered reads cache decoded data. Infinite queries cache pages and page parameters. Accumulated streamed queries cache emissions in order. Live queries cache the latest value. HTTP metadata caches decoded data alongside immutable snapshots of the status and raw headers. Mutation variables supply execution input and do not contribute to mutation-key identity.

[Feature Support](/effect-api-query/getting-started/feature-support/) lists supported contract shapes. [RPC Utility Tree](/effect-api-query/concepts/rpc-utility-tree/) explains dotted tags. [HTTP Utility Tree](/effect-api-query/concepts/http-utility-tree/) explains literal group and endpoint identifiers and omitted endpoints.

## Keep input, cached data, and observer data distinct

RPC constructors can supply defaults before key preparation. HTTP builders accept decoded request containers without RPC construction. Equivalent canonical inputs share cache identity. Distinct views have separate identities. See [Inputs and Query Data](/effect-api-query/concepts/data-normalization/) and [Semantic Keys](/effect-api-query/concepts/semantic-keys/).

An observer's `select` projects data without changing the cached representation. Buffered and live `undefined` values become `null`. Mutation results and accumulated stream elements retain `undefined`. When you extract reusable application code, infer these types from the generated leaf.

## Ownership at the boundary

The package owns generated keys and functions, view identity, and adaptation of failed Effect Exits. TanStack owns caching, observers, retries, invalidation, and framework hooks. Your application owns ready clients, runtimes, transport, authentication, providers, lifecycle, and the relationships between writes and reads.

The same generated options work in native QueryClient calls, framework hooks, and router loaders. [Defaults and Policies](/effect-api-query/guides/query-defaults/) explains how reusable policy retains the leaf's types. [Integrations](/effect-api-query/integrations/) shows how each consumer uses the options.
