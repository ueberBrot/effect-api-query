# Rethrow pending pull failures during stream cleanup

Status: Accepted. Clarifies [ADR 0037](0037-own-stream-publication-through-query-core.md).

In `src/core/stream-publication.ts`, `finishPublication` awaits any in-flight `pull` promise inside `finally` after calling `iterator.return?.()` and rethrows if that pull settled with an error. A publication deadline can win the race while cancellation's finalizer failure is still resolving inside the pending pull, so dropping the pull result would lose that failure Cause.
