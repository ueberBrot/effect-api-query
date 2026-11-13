# Bound Effect support to a patch line

Status: Accepted. Validation and prospective versioning extended by [ADR 0042](0042-define-the-compatibility-promise.md); the current manifest admits both reviewed 4.0 and 4.1 minors. Supersedes the exact-peer policy in [ADR 0001](0001-target-effect-4-release-candidate.md) and amends the peer constraint in [ADR 0025](0025-use-public-decoded-message-clients-for-server-local-rpc.md). ADR 0025's lifecycle and authority decision remains accepted.

## Context

The adapters use upstream RPC and HTTP API modules that still declare unstable APIs. Requiring one exact Effect peer forces consumers to upgrade whenever development adopts a patch, even when the adapters require no newer API or fix. Admitting future minors would expose consumers to a broader set of upstream changes without compatibility evidence.

## Decision

Support an explicitly bounded Effect patch line, initially `>=4.0.6 <4.1.0`. Keep exact, coordinated development pins separate from the published consumer peer range. Applications coordinate their Effect runtime, testing, and platform packages within that range. Development versions remain recorded in the package manifest, workspace catalog, and lockfile.

Raise the consumer minimum only when the implementation requires a newer API, type contract, or correctness fix. Otherwise retain the floor. Review upstream source and release notes for dependency updates and peer-range changes. Check public compiler fixtures and focused RPC/HTTP execution, cancellation, and hydration through a packed package at the supported floor and current development release. Use native package builds and relevant framework consumers to check development dependencies. Check this floor/current pair rather than every intermediate patch.

Apply the unchanged [seven-day dependency policy](0017-quarantine-new-dependency-releases-for-seven-days.md) to development updates and peer-range changes. Review a future Effect minor and verify compatibility before changing the upper bound.

## Evidence and consequences

[CI run 41833854445](https://github.com/ueberBrot/effect-api-query/actions/runs/41833854445) checks Effect `4.0.6` and `4.0.7` separately through packed consumers. Each passes the public compiler fixtures on TypeScript 7 and 5.9 and 109 selected runtime cases. `vp run effect-compatibility` repeats that floor/current check using the configured versions. The run also passes native package checks, framework consumer checks, and both application builds.

The range admits future patches within the selected line as a compatibility policy. These results establish evidence for the two tested releases; untested releases require continuing compatibility review. Stable Effect package versions and passing tests do not establish stability of its upstream RPC and HTTP API modules. Supporting an older release does not backport upstream transport fixes.
