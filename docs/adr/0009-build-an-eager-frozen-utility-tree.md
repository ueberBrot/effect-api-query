# Build an eager frozen utility tree

Status: Accepted. Implementation ownership clarified by [ADR 0021](0021-share-utility-construction-through-private-modules.md).

## Context

A Proxy or generated source makes the utility tree harder to inspect and introduces pitfalls at
runtime or during builds.

## Decision

The factory enumerates the RPC group's request map and builds an ordinary frozen object eagerly.
Before returning the tree, it validates the prefix, paths, collisions, and key-encoder configuration
atomically.

## Consequences

Prefixes, keys, and canonical payloads are frozen. Each generated option object is fresh and
unfrozen. Caller-owned option values remain untouched.
