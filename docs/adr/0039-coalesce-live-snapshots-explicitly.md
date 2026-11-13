# Coalesce live snapshots explicitly

Status: Accepted. Extends [ADR 0020](0020-generate-accumulated-and-live-stream-queries.md) and [ADR 0037](0037-own-stream-publication-through-query-core.md).

## Context

Frequent complete-state snapshots can cause unnecessary cache writes. Accumulated event histories cannot safely discard intermediate emissions.

## Decision

Add live-only `coalesceMs`. Publish the first value immediately, then retain one latest pending snapshot. Start a fixed deadline at the first pending value; replacements do not postpone it. Flush at the deadline even while a pull is pending, and flush on completion or error before settling. Empty live completion remains an error; undefined remains null.

Each fetch/refetch owns a fresh cycle. Cancellation discards pending state, clears timers and closes the iterator. Native Query cancellation may settle before local cleanup; preserve complete cleanup Causes and snapshot draining. Include explicit deadlines in direct and configured generated key identity; omission preserves existing keys.

## Consequences

Coalescing is opt-in for complete state. Raw consumption and accumulated retention/publication preserve their existing contracts. The adapter never mutates published values. Application ownership and remote cleanup limits remain unchanged.
