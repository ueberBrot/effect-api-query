# Normalize undefined query success to null

Status: Accepted.

## Context

TanStack Query rejects a successful `undefined` result. Effect RPC commonly uses `Schema.Void` and
runtime `undefined` for success.

## Decision

Buffered and live queries map successful `undefined` to cacheable `null` in both values and types.
Accumulated stream elements and mutation results preserve `undefined`, because neither needs this
normalization to produce valid query data.

## Consequences

Every unary RPC and live emission remains usable as query data without disguising a failure or an
empty stream. This is the adapter's only success-value normalization.
