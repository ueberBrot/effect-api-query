# Reuse TanStack Query Core as a peer

Status: Accepted.

## Context

The generated objects and declarations expose runtime values and types from TanStack Query Core.

## Decision

`@tanstack/query-core` is an external peer. Its supported v5 range must preserve `null` stream data. The package uses Query Core's experimental streamed-query interface. Dependency updates therefore require validation of public types and runtime behavior. The package re-exports only primitives that its interface requires, including the exact `skipToken` and `SkipToken` bindings.

## Consequences

Consumers can use the same bindings or broader Query APIs from their TanStack installation. `skipToken` applies only to payload-bearing query options. Until a public entry point imports React, React Query, or TanStack Start directly, those packages remain outside the peer set.
