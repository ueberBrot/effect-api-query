---
title: Data Normalization
description: Understand RPC payload defaults, decoded HTTP inputs, and undefined query results.
---

## Query-stable RPC payloads

A payload-bearing query constructs and normalizes its payload before it builds the key. The ready
RPC client constructs that value again during execution, so the payload Schema must be query-stable:
reconstruction must preserve every field that affects the RPC result. Constructor defaults then
describe both execution and cache identity.

Inputs that normalize to the same payload then share a cache entry. Custom key encoders also
receive the normalized payload.

## Decoded HTTP inputs

HTTP builders accept the decoded `params`, `query`, `headers`, and `payload` values declared by
the endpoint. They do not apply RPC constructor defaults. Key preparation schema-encodes those
values, while the ready HttpApiClient encodes them for execution.

Every declared request container remains required, even when its fields are optional. For example,
an endpoint with optional query filters still takes `input: { query: {} }` when no filter is selected.

## No-content and undefined query results

TanStack Query rejects `undefined` as successful query data. When an RPC or HTTP query succeeds
with `undefined`, the generated query resolves to `null` instead. The exported `QueryData<A>` type
models that rule.

An HTTP endpoint using `HttpApiSchema.NoContent` decodes its successful 204 response to
`undefined`, so its ordinary and infinite queries cache `null`.

Mutations keep the original success type. A mutation that succeeds with `undefined` still
resolves to `undefined`.

The [packed RPC consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/packed-consumer/runtime.mts) and
[packed HTTP consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/packed-consumer/http-runtime.mts) exercise these normalization rules.
