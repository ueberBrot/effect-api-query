# Preserve the Cause in one error wrapper

Status: Amended by ADR 0018 and ADR 0020. Implementation ownership clarified by [ADR 0021](0021-share-utility-construction-through-private-modules.md). Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

Flattening Effect failures discards information about typed failures, defects, interruptions, and parallel Causes.

## Decision

Only a failed RPC `Exit` becomes an `EffectRpcQueryError<E>`. The error preserves the untouched Effect `Cause<E>`, literal RPC tag, and operation. ADR 0018 adds infinite-query operations. ADR 0020 adds accumulated-stream and live-query operations.

Configuration failures use `EffectRpcQueryConfigError`. Key-generation failures use `EffectRpcQueryKeyError`. User callbacks, TanStack callbacks, and runner rejections that produce no `Exit` pass through unchanged.

## Consequences

Public errors expose discriminants and relevant tag or path metadata. They retain neither raw input nor encoder output. Query preparation fails synchronously. The Cause retains failures inside the RPC Effect.
