# Normalize undefined query success to null

Status: Accepted.

## Context

TanStack Query rejects successful results whose value is `undefined`. Effect RPC commonly uses `Schema.Void` and runtime `undefined` for success.

## Decision

Buffered and live queries map successful `undefined` to cacheable `null` in both values and types. Accumulated stream elements and mutation results preserve `undefined`. Neither needs this normalization to produce valid query data.

## Consequences

Every unary RPC result and live emission remains usable as query data. The conversion does not disguise failures or empty streams. The adapter makes no other success-value normalization.
