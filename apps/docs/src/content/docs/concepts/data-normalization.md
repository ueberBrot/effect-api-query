---
title: Data Normalization
description: Understand RPC payload defaults, decoded HTTP inputs, and undefined query results.
---

## Query-stable RPC payloads

A payload-bearing query constructs and normalizes its payload before it builds the key. The ready RPC client constructs that value again during execution. The payload Schema must therefore be query-stable: construction must preserve every field that affects the RPC result when repeated. Constructor defaults affect both execution and cache identity.

Inputs that normalize to the same payload share a cache entry. Custom key encoders also receive the normalized payload.

## Decoded HTTP inputs

HTTP builders accept the endpoint's declared, decoded `params`, `query`, `headers`, and `payload` values. They do not apply RPC constructor defaults. Key preparation encodes those values with their schemas. The ready HttpApiClient encodes them separately for execution.

Every declared request container remains required, even when its fields are optional. An endpoint with optional query filters still takes `input: { query: {} }` when you select no filter.

## Keep captured inputs unchanged

Query options retain the normalized RPC payload or decoded HTTP request for later execution. Keep the retained input and any nested mutable values unchanged while the options can run. When input changes, create new input and options. Do not modify the captured values.

Canonical keys copy and deeply freeze the encoded identity. They do not clone or freeze arbitrary execution inputs or decoded query data. RPC construction can retain nested values from the caller. HTTP preparation retains the decoded request. In reactive frameworks, rebuild options inside the framework's computed value or accessor.

## No-content and undefined query results

TanStack Query rejects `undefined` as successful query data. If a buffered RPC or HTTP query succeeds with `undefined`, the generated query resolves to `null`. The exported `QueryData<A>` type models that rule.

An HTTP endpoint using `HttpApiSchema.NoContent` or `success: []` decodes its successful 204 response to `undefined`, so its ordinary and infinite queries cache `null`. Its metadata view contains `data: null`.

Mutations keep the original success type. A mutation that succeeds with `undefined` still resolves to `undefined`.

Live queries also convert each emitted `undefined` to `null`. If a stream emits a value followed by `undefined`, its latest query data is `null`. Live keys, selectors, and `initialData` use the same normalized type. The first emission makes an open live query successful while it remains fetching. Completion without an emission raises `EffectRpcQueryEmptyStreamError` for RPC or `EffectHttpApiQueryEmptyStreamError` for HTTP SSE.

Accumulated streamed queries retain each emitted value as supplied. Their cached arrays can contain `undefined` elements.
