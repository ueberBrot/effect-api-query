# Target the Effect 4 release candidate

Status: Accepted. Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

Supporting Effect 3 and Effect 4 together would require the first release to support two incompatible
RPC APIs.

## Decision

The first public release targets `effect/unstable/rpc` from one exact Effect 4 release candidate.
Each release declares and tests one exact RC peer. An internal adapter isolates upstream extraction
and invocation.

## Consequences

Before `1.0`, breaking public changes raise the minor version and compatible changes raise the
patch. An RC-only upgrade may raise the patch when the public API remains compatible. The
project keeps a changelog from its first release and waits for a sufficiently stable Effect RPC
API before publishing `1.0`.
