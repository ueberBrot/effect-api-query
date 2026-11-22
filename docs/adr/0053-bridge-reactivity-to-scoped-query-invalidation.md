# Bridge Reactivity to scoped query invalidation

Status: Accepted.

## Context

Effect Reactivity publishes process-local invalidations from workflows such as SQL writes. Applications need to map those events to their own QueryClient and key prefixes. A subscription can also outlive a query owner's admission window during retirement.

## Decision

Export the opt-in `bindReactivityInvalidation` Effect from core. The caller provides the Reactivity service, QueryClientService, and Scope. Bindings map Reactivity keys to one or more native filters. Colocated filters preserve the utility tree's key prefix ([ADR 0051](0051-colocate-query-filters-on-utility-trees.md)).

Use Reactivity's native key matching after removing undefined record values. Application code owns any augmentation of `Reactivity.Keys`. Exact per-entity subscriptions can use string array keys because record keys also match their group name.

Coalesce triggers for each binding per microtask. Scope finalization unregisters listeners and drops queued work. Accept the guard from [query owner retirement](0040-add-opt-in-query-owner-retirement.md) so invalidations stop as soon as the owner retires.

## Consequences

`flush` waits for pending passes and native invalidations already in flight. QueryClient owns refetch execution and can continue it after the subscription closes. The application receives native failures through `onError` and coordinates any invalidation deferral around optimistic writes.

Each request or browser owner can use a separate Reactivity instance to isolate event delivery. Load Reactivity on demand so bundles that skip the bridge omit its peer import.
