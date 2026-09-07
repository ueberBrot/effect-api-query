# Use a Vite+ workspace with a root package

Status: Amended by ADR 0019 and [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md). Both adapters are private implementations within the single root package.

## Context

The repository needs one task graph without a speculative package split or a later move of the
initial release path.

## Decision

Use a Vite+ pnpm workspace with the publishable `effect-api-query` package permanently at the root.
Keep examples private. Future public packages may live under `packages/`.

## Consequences

The workspace accepts Vite+'s beta status. Private examples share RPC contracts and hosting code.
ADR 0019 supersedes this decision's original requirement that both browser examples use the
standalone server.
