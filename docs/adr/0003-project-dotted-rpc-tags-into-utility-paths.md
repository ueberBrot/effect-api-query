# Project dotted RPC tags into utility paths

Status: Amended by ADR 0018 and ADR 0020. Implementation ownership clarified by [ADR 0021](0021-share-utility-construction-through-private-modules.md). Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

Generated utilities need deterministic paths without a second name-mapping configuration.

## Decision

The literal Effect RPC tag is the sole source of its public utility path. Dot-separated segments
become nested properties. The factory rejects:

- empty segments;
- reserved utility names;
- `__proto__`, `prototype`, and `constructor`;
- every collision between a leaf and a branch.

All other string segments are valid, including segments that require bracket notation. The factory
provides neither escaping nor a separate path map.

## Consequences

This trades a small set of tag restrictions for deterministic, string-free access. ADR 0018 and ADR
0020 extend the reserved utility names with their generated builders.
