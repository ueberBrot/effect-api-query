---
title: Data Normalization
description: Understand RPC payload defaults, decoded HTTP inputs, and undefined query results.
---

## Query-stable RPC payloads

A payload-bearing query constructs and normalizes its payload before it builds the key. The ready
RPC client constructs that value again during execution, so the payload Schema must be query-stable:
reconstruction must preserve every field that affects the RPC result. Constructor defaults then
describe both execution and cache identity.

This avoids a split where two constructor inputs share an RPC meaning but occupy different cache
entries. Custom key encoders also receive the normalized payload.

## Decoded HTTP inputs

HTTP builders accept the decoded `params`, `query`, `headers`, and `payload` values declared by
the endpoint. They do not apply RPC constructor defaults. Key preparation schema-encodes those
values, while the ready HttpApiClient encodes them for execution.

Every declared request container remains required, even when its fields are optional. For example,
an endpoint with optional query filters still takes `input: { query: {} }` when no filter is selected.

## Undefined query results

TanStack Query rejects `undefined` as successful query data. If an RPC or HTTP query success type may be
`undefined`, the generated query resolves to `null` instead. The exported `QueryData<A>` type models
that rule.

Mutations keep the original success type. A mutation that succeeds with `undefined` still
resolves to `undefined`.
