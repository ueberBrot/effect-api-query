---
title: Data Normalization
description: Understand RPC payload defaults, decoded HTTP inputs, and undefined query results.
---

## Query-stable RPC payloads

A payload-bearing query constructs and normalizes its payload before it builds the key. The ready
RPC client constructs that value again during execution, so the payload Schema must be query-stable:
reconstruction must preserve every field that affects the RPC result. Constructor defaults then
describe both execution and cache identity.

Inputs that normalize to the same payload share a cache entry. Custom key encoders also
receive the normalized payload.

## Decoded HTTP inputs

HTTP builders accept the decoded `params`, `query`, `headers`, and `payload` values declared by
the endpoint. They do not apply RPC constructor defaults. Key preparation encodes those values
with their schemas; the ready HttpApiClient encodes them separately for execution.

Every declared request container remains required, even when its fields are optional. For example,
an endpoint with optional query filters still takes `input: { query: {} }` when no filter is selected.

## Keep captured inputs unchanged

Query options retain the normalized RPC payload or decoded HTTP request for later execution.
Keep those values and their nested mutable values unchanged while the options can run. When input
changes, create new input and options rather than modifying the captured values.

Canonical keys copy and deeply freeze the encoded identity. They do not clone or freeze arbitrary
execution inputs or decoded query data. RPC construction can retain nested caller values; HTTP
preparation retains the decoded request. In reactive frameworks, rebuild options inside the
framework's computed value or accessor.

## No-content and undefined query results

TanStack Query rejects `undefined` as successful query data. When a buffered RPC or HTTP query succeeds
with `undefined`, the generated query resolves to `null` instead. The exported `QueryData<A>` type
models that rule.

An HTTP endpoint using `HttpApiSchema.NoContent` decodes its successful 204 response to
`undefined`, so its ordinary and infinite queries cache `null`.

Mutations keep the original success type. A mutation that succeeds with `undefined` still
resolves to `undefined`.

Live queries also convert each emitted `undefined` to `null`. A stream emitting a value followed
by `undefined` ends with `null` as its latest query data. Live keys, selectors, and `initialData`
use the same normalized type. The first emission makes an open live query successful while it
remains fetching; completion without any emission raises `EffectRpcQueryEmptyStreamError` for RPC
or `EffectHttpApiQueryEmptyStreamError` for HTTP SSE.

Accumulated streamed queries retain emitted values as supplied, including `undefined` elements
inside their cached arrays.
