# Target one exact Effect 4 release

Status: Accepted. Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

Supporting Effect 3 and Effect 4 together in the first release would require two incompatible
RPC APIs. The repository targets stable Effect 4, whose RPC and HTTP API modules still declare
unstable APIs.

## Decision

The first public release targets `effect/rpc` and `effect/http-api` from one exact Effect 4 release.
Each release declares and tests one exact Effect peer. Keep the exact pin while the adapters
depend on unstable upstream APIs.
Internal adapters isolate upstream extraction and invocation.

## Consequences

Review upstream dependencies when adding an API or upgrading Effect. Each coordinated Effect
upgrade requires published-type, runtime, and packed-consumer checks.

Before `1.0`, breaking public changes raise the minor version and compatible changes raise the
patch. An Effect-only upgrade may raise the patch when the public API remains compatible. The
project keeps a changelog from its first release. Before publishing `1.0`, it evaluates the stability
of the upstream RPC and HTTP APIs. The Effect package's stable version alone does not establish
the stability of those APIs.
