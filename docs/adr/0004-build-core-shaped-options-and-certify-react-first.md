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

Package-level policy helpers bind typed native defaults to a leaf's existing options builder.
They preserve its overloads and apply call-site overrides after defaults. Inputs, selection,
initial data, pagination mappers, adapter controls, and generated identity remain local to each
call. Mutation policies leave `onMutate` local; shared callbacks receive an unknown optimistic
result and are replaced by corresponding call-site callbacks.

## Consequences

Applications own providers, reactive option rebuilding, router context, and SSR integration.
