# Require query-stable payload construction

Status: Accepted.

## Context

Query options derive a synchronous key before execution. The ready RPC client then constructs the
retained normalized payload again. Effect does not guarantee that every Schema constructor accepts
its own `Type` or preserves encoded meaning across repeated construction.

## Decision

Query use requires a query-stable payload Schema. Standard struct-shaped payloads and materialized
defaults are the supported path.

## Consequences

Constructor-sensitive Schemas remain available to mutations. Query callers instead expose a stable
query-facing RPC; the initial release adds no custom execution seam for this case.
