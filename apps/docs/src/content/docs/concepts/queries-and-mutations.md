---
title: Generated Utility Model
description: Understand the contract, input, data, error, and cache identity carried by generated leaves.
---

Pass the factory an Effect declaration, its ready client, and a cache prefix. The factory builds a frozen utility tree. Each leaf represents one RPC or HTTP endpoint and provides methods for its supported operations.

## What a generated leaf carries

| Part | Contract |
| --- | --- |
| Input | RPC payload constructor input or the complete decoded HTTP request |
| Query data | Decoded data for the selected cache view, before an observer's `select` |
| Execution failure | Declaration identity plus the complete Effect Cause from a failed Exit |
| Cache identity | Caller prefix, adapter and declaration path, view, canonical input, and applicable view policy |
| Options | Generated key and function with the applicable native TanStack options |

A buffered query caches decoded data. Each other query view has its own cache shape. Infinite queries store pages and page parameters, accumulated streams store ordered values, and live queries store the latest value. The HTTP metadata view also stores a copy of the status and raw headers. Mutation keys identify the operation. Pass the variables when the mutation runs.

See [supported operations](/effect-api-query/getting-started/feature-support/) for the available views. Learn how [RPC tags](/effect-api-query/concepts/rpc-utility-tree/) and [HTTP names](/effect-api-query/concepts/http-utility-tree/) become paths.

## Keep input, cached data, and observer data distinct

RPC constructors can supply defaults. HTTP builders take decoded request objects. Equivalent inputs share a cache entry when they produce the same key. Each query view has its own key. See [inputs and query data](/effect-api-query/concepts/data-normalization/) and [semantic keys](/effect-api-query/concepts/semantic-keys/).

Use `select` to return part of the result from an observer while keeping the full value in the cache. Infer types for reusable code from the generated leaf. See [type inference](/effect-api-query/reference/type-inference/).

## Ownership at the boundary

The library builds keys and query functions and translates failed Effect Exits. TanStack Query stores results and handles observers, retries, and invalidation. Your app supplies the client, transport, and runtime. After a write, your app decides how to update affected reads.

Pass generated options to QueryClient, a framework hook, or a router loader. See [integrations](/effect-api-query/integrations/) for examples and [defaults and policies](/effect-api-query/guides/query-defaults/) to share typed defaults.
