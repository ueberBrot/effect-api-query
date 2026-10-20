# Keep the core factory lifecycle-neutral

Status: Accepted. Implementation ownership clarified by [ADR 0021](0021-share-utility-construction-through-private-modules.md). Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

The application determines the protocol, middleware, runtime, and resource lifetime that it needs in the browser or on the server.

## Decision

The core factory accepts a ready flat Effect RPC client. It never constructs, scopes, or disposes that client. Service-free calls default to `Effect.runPromiseExit`. If Schema services remain, inject a runner with the same `effect, { signal? }` shape.

## Consequences

The caller owns the protocol, middleware, lifetime, and resources. Queries forward TanStack's abort signal. Mutations omit that signal. Runner rejections propagate unchanged.

[ADR 0026](0026-keep-rpc-transport-aggregation-in-the-application.md) preserves application ownership of transport aggregation.
