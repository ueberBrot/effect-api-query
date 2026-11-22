# Flatten utility policy maps

Status: Accepted. Partially amends [ADR 0032](0032-configure-utility-trees-and-require-stream-retention.md) for configuration syntax.

## Context

A policy for one descendant required a nested wrapper for each branch. View options also sat inside a separate object from interceptors and mutation callback controls. Reusable policy maps required callers to write out a utility type that the contract already described.

## Decision

Put view options beside `interceptors` and mutation `callbacks`. Use a flat `paths` map on trees and branches. Resolve relative paths against the actual utility segments, including dots in literal HTTP identifiers. Reject unknown and ambiguous paths before accessing leaves. Apply configuration from broad to specific regardless of property order. A leaf accepts its view configuration directly.

Infer reusable maps from a contract with `defineRpcPolicy` or `defineHttpApiPolicy`. Both accept the utility tree's `keyPrefix` through an optional third argument. RPC policies use `RpcClientError` by default and accept a custom error through `defineRpcPolicy.withClientError<E>()`.

Read path names from the phantom metadata in [ADR 0046](0046-lazy-memoized-frozen-leaves-and-unified-key-inputs.md). Preserve that metadata when a policy supplies required stream retention so later configuration calls still infer paths.

## Consequences

Leaf callbacks retain their operation types. Stream retention, option precedence, and callback composition follow ADR 0032. Applications can configure a branch or leaf directly when distinct HTTP nodes share one dotted path.
