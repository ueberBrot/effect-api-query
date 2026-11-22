# Use native cache operations in Effect

Status: Accepted. Extends [ADR 0007](0007-keep-the-core-factory-lifecycle-neutral.md) and [ADR 0040](0040-add-opt-in-query-owner-retirement.md).

## Context

Effect programs reuse the application's QueryClient. A fetch can serve several waiters or observers. A stream snapshot has exclusive access to its query during capture.

## Decision

Expose the current Query Core execution and cache operations through `queryEffects`. Preserve native selection and freshness rules. Keep the cause of a failed operation in `QueryClientOperationError` because a shared query can fail with a value from another caller. Prefetching discards failures.

Fiber interruption stops the wait for shared work. For a stream snapshot, combine the fiber and caller signals so either can cancel capture and trigger local cleanup.

## Consequences

The caller keeps ownership of the QueryClient and its resources. Call `queryEffects.cancel` to stop shared work. With a query owner, provide its QueryClient and track the utility tree so retirement drains local work before releasing resources.
