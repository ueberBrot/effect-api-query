# Bound Effect support to a checked patch line

Status: Accepted. Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

Supporting both Effect 3 and Effect 4 in the first release requires two incompatible RPC APIs. The repository targets stable Effect 4. Its RPC and HTTP API modules still declare unstable APIs.

## Decision

Target `effect/rpc` and `effect/http-api` within an explicitly bounded Effect 4 patch line. The published peer is `>=4.0.6 <4.1.0`. This replaces the original exact-peer policy. Internal adapters isolate upstream extraction and invocation.

Keep exact, coordinated development pins separate from the consumer peer range. Development currently uses Effect, Node platform, and Vitest packages at `4.0.7`; consumers can retain `4.0.6` with its matching integrations.

Raise the consumer minimum when the implementation requires a newer API, type contract, or correctness fix. Otherwise retain the minimum. Review upstream source and release notes and check public compiler fixtures, focused RPC/HTTP execution, cancellation and hydration, native package builds, and relevant consumers before widening support. Check the supported floor and current development release rather than every intermediate patch. A future Effect minor requires a new compatibility review before changing the upper bound.

## Consequences

Every development update and peer-range change follows the strict seven-day dependency policy. Use `vp run effect-compatibility` for the floor/current packed-consumer check and the normal native package and framework checks for development dependencies. Upstream transport fixes remain owned by Effect; supporting an older release does not backport them.

Before `1.0`, breaking public changes raise the minor version. Compatible changes raise the patch. If the public API remains compatible, an Effect-only upgrade can raise the patch. Before publishing `1.0`, evaluate the stability of the upstream RPC and HTTP APIs. A stable Effect package version does not establish that those APIs are stable.
