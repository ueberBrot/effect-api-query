# Project dotted RPC tags into utility paths

Status: Amended by ADR 0018 and ADR 0020. Implementation ownership clarified by [ADR 0021](0021-share-utility-construction-through-private-modules.md). Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

Generated utilities need deterministic paths without a separate configuration that maps names.

## Decision

The literal Effect RPC tag determines its public utility path. Dot-separated segments become
nested properties. The factory rejects these segments and collisions:

- Empty segments.
- Reserved utility names.
- `__proto__`, `prototype`, and `constructor`.
- Every collision between a leaf and a branch.

All other string segments are valid, including those that require bracket notation. The factory
provides no escaping or separate path map.

## Consequences

These tag restrictions provide deterministic access without strings. ADR 0018 and ADR 0020 add
their generated builder names to the reserved utility names.
