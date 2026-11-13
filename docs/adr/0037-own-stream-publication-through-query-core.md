# Own stream publication through Query Core

Status: Accepted. Partially amends [ADR 0010](0010-reuse-tanstack-query-core-as-a-peer.md). Clarifies implementation of [ADR 0020](0020-generate-accumulated-and-live-stream-queries.md), [ADR 0031](0031-add-explicit-query-reuse-and-stream-controls.md), and [ADR 0034](0034-extend-http-stream-views-to-decoded-ndjson.md). Extended by [ADR 0039](0039-coalesce-live-snapshots-explicitly.md) for opt-in live snapshot coalescing.

## Context

Query Core exposes streamed queries as experimental. Its helper controls reset, reduction, publication, and final cache reads, making upstream changes part of our accumulated and live contract. The adapter already owns Effect iteration, cancellation, ordered publication batches, and hash validation.

## Decision

Consume streams inside the adapter using public Query Core primitives: resolve and validate the query through the existing hash index, reset its state through `Query.setState`, publish through `QueryClient.setQueryData`, and read through `QueryClient.getQueryData`. Query Core continues to own fetch status, observers, retries, structural sharing, and cancellation. Remove the experimental helper from shipped source without changing public options, keys, hashes, or data shapes.

Keep reset/append/replace and bounded/unbounded retention. Live emissions normalize undefined to null and empty live streams fail. The first accumulated emission publishes immediately; subsequent batches flush by count, deadline, or termination. Replace refetches publish only after successful completion. Native cache writes remain visible to the reducer. Completion returns the current cached representation.

Keep the Effect iterator and cleanup bridge unchanged. Aborting a pending pull interrupts local work; the generated query function awaits its iteration cleanup and preserves complete consumption and finalizer Causes. Native Query cancellation may settle earlier, and replacement work may start before old cleanup finishes. Stream snapshots retain their exclusive ownership and awaited local cleanup. None of these operations acknowledges remote cleanup.

## Evidence and consequences

Public RPC and HTTP utility/QueryClient regressions cover refetch modes, seeded history, null normalization, SSE/NDJSON decoded headers, native hashing, structural sharing, deadlines, pending-pull interruption and composite finalizer Causes. Repeated observer lifetimes must leave unrelated queries running. Existing failure regressions reproduce no additional cleanup defect, so this amendment introduces no speculative cleanup fix.

The indexed execution path avoids subsequent full-cache enumeration; the experimental helper's lookup previously enumerated the cache per execution. Retain the declared Query Core peer range; compatibility matrix expansion remains separate work under spec #166. Applications continue to own clients, runtimes, transport policy, and cleanup coordination.
