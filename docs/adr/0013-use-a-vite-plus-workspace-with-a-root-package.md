# Use a Vite+ workspace with a root package

Status: Amended by ADR 0019 and [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md). Both adapters are private implementations within the single root package.

## Context

The repository needs one task graph. The initial release path must stay in place without requiring
a package split before one is needed.

## Decision

Use a Vite+ pnpm workspace. Keep the publishable `effect-api-query` package permanently at the root
and keep examples private.

## Consequences

Private examples share RPC contracts and hosting code. ADR 0019 replaces this decision's original
requirement that both browser examples use the standalone server.
