# Require query-stable payload construction

Status: Accepted.

## Context

Query options derive a key synchronously before execution. The ready RPC client reconstructs the retained normalized payload when it executes. Effect does not guarantee that every Schema constructor accepts its own `Type` or preserves encoded meaning when construction repeats.

## Decision

Queries require a query-stable payload Schema. The supported path uses standard struct-shaped payloads and materialized defaults.

## Consequences

Mutations can still use constructor-sensitive Schemas. For queries, callers expose a stable query-facing RPC. The initial release adds no custom execution seam for this case.
