# Add opt-in query owner retirement

Status: Accepted. Extends [ADR 0007](0007-keep-the-core-factory-lifecycle-neutral.md) without changing factory ownership.

## Context

Applications repeat resource acquisition, query finalizer tracking and retirement guards. Query Core cancellation settlement alone does not acknowledge Effect cleanup. Native mutation callbacks can outlive their request attempt.

## Decision

Provide a separate optional `acquireQueryOwner` helper. Each owner has an independent native QueryClient, an explicit acquired/borrowed resource boundary, wrapped runners, complete-promise mutation tracking and a synchronous guarded cache callback. Retirement rejects new attempts, aborts queries, drains registered promises, clears the cache and releases acquired resources in reverse order. Repeated disposal shares one outcome. Preserve complete Causes and collect drain/release failures while attempting all releases. No automatic timeout, offline queue, domain cancellation or remote acknowledgment is implied.

## Consequences

Applications still choose ready clients, transport, identity, runtime and cache policy. They wrap every query/stream runner, await acquisitions, guard side effects and remount native consumers on replacement. Only explicitly accepted promises and their awaited callbacks are drained; detached work remains application-owned. Factories and native hooks remain lifecycle-neutral.
