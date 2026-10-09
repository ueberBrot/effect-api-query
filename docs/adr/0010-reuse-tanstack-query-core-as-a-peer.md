# Reuse TanStack Query Core as a peer

Status: Accepted.

## Context

Generated objects and declarations expose TanStack Query Core runtime values and types.

## Decision

`@tanstack/query-core` is an external peer. The package supports v5 releases from 5.103.1 and tests
its declared lower bound and development version. This minimum preserves `null` data in the
streamed-query helper. Because the package imports Query Core's
experimental streamed-query interface, each development update must pass packed-consumer type and
runtime checks. The package re-exports only primitives required by its own interface, including the
exact `skipToken` and `SkipToken` bindings.

## Consequences

Consumers use the same bindings, or broader Query APIs, from their TanStack installation.
`skipToken` applies only to payload-bearing query options. React, React Query, and TanStack Start
remain outside the peer set until a public entry point imports them directly.

## Evidence

[`tests/packed-consumer/runtime.mts`](../../tests/packed-consumer/runtime.mts) exercises
undefined-only, null-only, value-then-undefined, empty, and open live streams with the minimum and
development peers. [`tests/types/public-contract.ts`](../../tests/types/public-contract.ts) verifies
normalized live data with TypeScript 5.9 and the repository compiler.
