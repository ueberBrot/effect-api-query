# Target one exact Effect 4 release

Status: Accepted. Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

Supporting both Effect 3 and Effect 4 in the first release requires two incompatible RPC APIs.
The repository targets stable Effect 4. Its RPC and HTTP API modules still declare unstable APIs.

## Decision

The first public release targets `effect/rpc` and `effect/http-api` from one exact Effect 4 release.
Each release declares and tests one exact Effect peer. While the adapters depend on unstable upstream
APIs, keep that exact pin. Internal adapters isolate upstream extraction and invocation.

## Consequences

When adding an API or upgrading Effect, review upstream dependencies. Each coordinated Effect
upgrade requires checks of public types, runtime behavior, and native builds.

Before `1.0`, breaking public changes raise the minor version. Compatible changes raise the patch.
If the public API remains compatible, an Effect-only upgrade can raise the patch.
Before publishing `1.0`, evaluate the stability of the upstream RPC and HTTP APIs.
A stable Effect package version does not establish that those APIs are stable.
