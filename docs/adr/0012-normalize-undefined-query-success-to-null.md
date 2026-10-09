# Normalize undefined query success to null

Status: Accepted.

## Context

TanStack Query rejects a successful `undefined` result. Effect RPC commonly uses `Schema.Void` and
runtime `undefined` for success.

## Decision

Generated buffered query functions and live-stream reducers map successful `undefined` to cacheable
`null`. Their query-data types replace `undefined` with `null`, including key DataTags, selectors,
and initial data. Explicit `null` stays `null`. Accumulated stream elements and mutation results
preserve `undefined`: an array containing `undefined` remains cacheable query data.

## Consequences

Every unary RPC remains usable as a query without disguising an upstream failure. Every live
emission becomes the latest query data, including an undefined emission after a defined value.
An undefined emission counts as the first value; an empty live stream still fails. This is the
adapter's only success-value normalization.
