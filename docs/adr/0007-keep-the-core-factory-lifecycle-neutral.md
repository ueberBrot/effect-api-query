# Keep the core factory lifecycle-neutral

Status: Accepted. Implementation ownership clarified by [ADR 0021](0021-share-utility-construction-through-private-modules.md). Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

The application knows the required protocol, middleware, runtime, and resource lifetime in the
browser or on the server.

## Decision

The core factory accepts a ready flat Effect RPC client. It never constructs, scopes, or disposes
that client. Service-free calls default to `Effect.runPromiseExit`; residual Schema services require
an injected runner with the same `effect, { signal? }` shape.

## Consequences

The caller owns protocol, middleware, lifetime, and resources. Queries forward TanStack's abort
signal, mutations omit it, and runner rejections propagate untouched.
