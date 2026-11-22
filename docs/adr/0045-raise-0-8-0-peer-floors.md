# Raise 0.8.0 peer dependency floors

Status: Accepted. Amends the peer floor constraints in [ADR 0033](0033-bound-effect-support-to-a-patch-line.md) and [ADR 0042](0042-define-the-compatibility-promise.md); the bounded patch-line and compatibility-validation policies remain accepted. Versioning continues to follow [ADR 0001](0001-target-effect-4-release-candidate.md).

## Context

The `0.8.0` release adopts Effect `4.1.4` APIs (including direct contract schema access for hydration and `Reactivity`) and `@tanstack/query-core` `5.107.1` APIs (canonical `query`/`infiniteQuery` methods and narrowed filter types). Supporting Effect `4.0.x`, Effect `<4.1.4`, or Query Core `<5.107.1` is incompatible with those contracts.

## Decision

Raise published consumer `peerDependencies` to `effect >=4.1.4 <4.2.0` and `@tanstack/query-core >=5.107.1 <6` for `0.8.0`. Keep the root entrypoint strictly framework-agnostic with no mandatory framework peers. Verify the `effect@4.1.4` and `@tanstack/query-core@5.107.1` floors across pinned TSRS and TypeScript 5.9.3 via `vp run effect-compatibility`.

## Consequences

Dropping Effect `<4.1.4` and Query Core `<5.107.1` is a pre-1.0 minor release per [ADR 0001](0001-target-effect-4-release-candidate.md) and [ADR 0042](0042-define-the-compatibility-promise.md). Future patches within each bounded range still require explicit compatibility review.
