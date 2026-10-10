# Reuse TanStack Query Core as a peer

Status: Accepted.

## Context

Generated objects and declarations expose TanStack Query Core runtime values and types.

## Decision

`@tanstack/query-core` is an external peer. Its supported v5 range must preserve `null` stream
data. The package uses Query Core's experimental streamed-query interface, so dependency updates
require public-type and runtime validation. The package re-exports only primitives required by its
own interface, including the exact `skipToken` and `SkipToken` bindings.

## Consequences

Consumers use the same bindings, or broader Query APIs, from their TanStack installation.
`skipToken` applies only to payload-bearing query options. React, React Query, and TanStack Start
remain outside the peer set until a public entry point imports them directly.
