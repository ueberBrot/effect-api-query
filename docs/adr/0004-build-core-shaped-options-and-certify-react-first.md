# Build core-shaped options and certify React first

Status: Accepted.

## Context

Framework-specific adapters expand the public API before a framework requires a distinct runtime contract.

## Decision

Generated options use static TanStack Query Core shapes. React Query hooks, `QueryClient`-driven TanStack Router loaders, and TanStack Start accept them unchanged. The package imports no framework adapter. It certifies React Query and TanStack Start first.

The library owns generated keys and functions. QueryClient global and prefix defaults control hashing. Generated fetches, stream publications, and native cache reads and writes therefore share one entry. Builders reject per-call hashing overrides because native key-only cache access cannot honor them. Callers can provide every other applicable Query Core option.

Package-level policy helpers bind typed native defaults to a leaf's existing options builder. They preserve its overloads and apply call-site overrides after defaults. Inputs, selection, initial data, pagination mappers, adapter controls, and generated identity remain local to each call. Mutation policies leave `onMutate` local. Shared callbacks receive an unknown optimistic result. Corresponding call-site callbacks replace them.

## Consequences

Applications own providers, reactive option rebuilding, router context, and SSR integration.
