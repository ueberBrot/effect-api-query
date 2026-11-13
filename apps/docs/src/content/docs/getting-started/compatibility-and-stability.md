---
title: Compatibility and Stability
description: Check dependency requirements, tested integrations, module format, and the release policy.
---

Import both factories from the `@ueberbrot/effect-api-query` package root. They use the same peer dependencies. Check your installed package's manifest for its peer requirements. See [Requirements and tested integrations](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) for library peers, native framework requirements, and exact checked versions.

This website documents the package version shown in its header. The repository's `main` branch can contain unreleased changes.

The package is ESM-only and targets ES2022. Enable strict TypeScript checking. The minimum consumer compiler is TypeScript 5.9; the current checked compiler is the selected TypeScript 7.1 beta through TSRS. Intermediate compiler versions are admitted but not individually checked. Future TypeScript majors require explicit review; an open-ended “5.9 or newer” is not a promise about unreviewed majors.

Effect is stable, while its RPC and HTTP API modules declare unstable APIs. The published Effect peer range is `>=4.0.6 <4.2.0`. Keep the application's Effect runtime, testing, and platform packages on a coordinated release within that range. Exact development pins are separate: this repository uses `4.1.0`. The packed matrix checks Effect `4.0.6` (minimum), `4.0.7` (4.0 representative), `4.1.0` (development) and `4.1.2` (4.1 representative), each with Query Core `5.104.4` (minimum) and `5.105.0` (selected development version).

The package raises its minimum when it needs a newer API, type contract, or correctness fix. Otherwise it retains the floor and widens support only after checking upstream changes, public types, execution, cancellation, hydration, builds, and relevant consumers. Checks cover these exact combinations rather than every intermediate patch. The ranges express supported compatibility, not exhaustive test coverage. Reviewed representatives are pinned and refreshed deliberately under the seven-day dependency age policy; CI never selects latest. Effect 4.2 and later minors require another compatibility review. Supporting an older release does not backport upstream transport fixes.

The adapter owns stream execution using public Query Core primitives; it does not delegate its stream guarantees to the experimental streamed-query helper. Pin Query packages to the checked versions and keep the native wrapper's resolved Core version aligned with the application. Consult the compatibility table before upgrading.

Choose the [RPC quick start](/effect-api-query/getting-started/quick-start/) or [HTTP quick start](/effect-api-query/getting-started/http-quick-start/) for your declaration.

## Supported public contract

- Builders preserve literal contract paths, accepted inputs, decoded query data, failure inference, native option assignability and documented configuration precedence. Public compiler fixtures include expected errors so unsupported calls remain rejected.
- Canonical key identity uses normalized, query-stable RPC payloads or decoded HTTP request input and immutable JSON-safe canonical payloads. Equivalent supported inputs share identity. Adapter, API, operation/view and semantic policy segments keep distinct cache shapes separate. Callers keep captured input unchanged and own tenant/user prefixes. Native reads, writes and generated execution use the QueryClient's hashing policy.
- Buffered and live query success converts `undefined` to `null`, in both values and types. Mutation results and accumulated elements preserve `undefined`. An initially unseeded empty accumulated stream yields an empty sequence; append refetches preserve existing history when no values arrive; empty live streams fail. Reset, append, replace, retention and opt-in publication policies retain their documented semantics.
- Failed execution Exits become the public RPC or HTTP execution error with the complete Cause and operation metadata; HTTP errors also identify API, group, endpoint and method. Preparation/configuration/key failures stay separate. Callback and runner rejections without an Exit pass through. Errors do not deliberately retain request input; a domain failure inside the Cause may contain application data.
- Queries forward native cancellation to local Effect work. Generated stream consumption awaits local iterator cleanup and preserves consumption/finalizer Causes. Native Query cancellation may settle sooner, and replacement work can overlap prior cleanup. Mutations have no automatic cancellation signal. Applications own client Scopes, runtimes and transport disposal. No remote rollback, cleanup acknowledgement or exactly-once delivery is promised.

These execution guarantees describe generated native options. The optional [Effect cache bridge](/effect-api-query/guides/query-effects/) reports every native rejection as `QueryClientOperationError`, retaining the exact original value in `cause`, including generated execution errors and their complete Causes. Its cause is typed as unknown because a Promise rejection cannot establish the current query's declared failure payload. Interrupting a bridge waiter leaves shared QueryClient execution running; applications cancel the native query explicitly when they own that decision.

Hydration uses explicitly registered paired codecs for decoded views; infinite data also needs a page-parameter codec. The matrix reuses public RPC/HTTP execution, stream publication/hashing, cancellation, metadata and hydration regressions, plus all public compiler fixtures with both pinned TSRS and TypeScript 5.9.3. It verifies packed artifacts and shared peer resolution. Native framework fixtures and app builds separately check the selected development combination; the matrix does not certify every framework against every peer combination.

## Versioning

Before 1.0, breaking public changes and supported dependency or compiler drops raise the minor version. Additive capabilities and verified dependency-range extensions also raise the minor version. Compatible fixes and internal tooling changes raise the patch version.

A development pin update within an unchanged supported range is internal tooling when it changes no public behavior. Raising the minimum drops support and requires compatibility checks. See [ADR 0001](https://github.com/ueberBrot/effect-api-query/blob/main/docs/adr/0001-target-effect-4-release-candidate.md).
