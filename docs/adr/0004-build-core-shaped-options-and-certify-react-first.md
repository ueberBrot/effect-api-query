# Build core-shaped options and certify React first

Status: Accepted.

## Context

Framework-specific adapters would widen the public surface before a framework requires a distinct
runtime contract.

## Decision

Generated options use static TanStack Query Core shapes. They pass unchanged to React Query hooks,
`QueryClient`-driven TanStack Router loaders, and TanStack Start. The package imports no framework
adapter and certifies React Query and TanStack Start first.

The library owns generated keys and functions. QueryClient global and prefix defaults own hashing
so generated fetches, stream publications, and native cache reads and writes share one entry.
Builders reject per-call hashing overrides because native key-only cache access cannot honor them.
Callers may provide every other applicable Query Core option.

## Consequences

Applications own providers, router context, and SSR integration. A future reactive contract may add
a dedicated adapter entry point when core-shaped options are insufficient.
