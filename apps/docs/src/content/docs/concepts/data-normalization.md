---
title: Data Normalization
description: Understand query-stable payloads and undefined query results.
---

## Query-stable payloads

A payload-bearing query constructs and normalizes its payload before it builds the key. The ready
RPC client constructs that value again during execution, so the payload Schema must be query-stable:
reconstruction must preserve every field that affects the RPC result. Constructor defaults then
describe both execution and cache identity.

This avoids a split where two constructor inputs share an RPC meaning but occupy different cache
entries. Custom key encoders also receive the normalized payload.

## Undefined query results

TanStack Query rejects `undefined` as successful query data. If an RPC query success type may be
`undefined`, the generated query resolves to `null` instead. The exported `QueryData<A>` type models
that rule.

Mutations keep the original RPC success type. A mutation that succeeds with `undefined` still
resolves to `undefined`.
