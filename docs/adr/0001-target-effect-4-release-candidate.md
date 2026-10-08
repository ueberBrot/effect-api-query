# Target one exact Effect 4 release

Status: Accepted. Extended by [ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md).

## Context

Supporting Effect 3 and Effect 4 together in the first release would require two incompatible
RPC APIs. The repository initially targeted the Effect 4 release candidate and now targets stable
Effect 4. Its RPC and HTTP API modules still declare unstable APIs.

## Decision

The first public release targets `effect/rpc` and `effect/http-api` from one exact Effect 4 release.
Each release declares and tests one exact Effect peer. Internal adapters isolate upstream extraction
and invocation. Keep the exact pin while the adapters depend on unstable upstream APIs.

Effect diagnostics suppress `unstableApiUsage` in `src/http` and `src/rpc`, the transport tests,
and the compile-time contract fixtures in `tests/types`. These areas deliberately use the exact
peer's unstable modules. Directory and filename patterns cover new adapter and contract files;
mixed-purpose examples retain explicit file exceptions. The warning remains enabled in `src/core`,
scripts, and all other files. All other diagnostics remain enforced.

The exception suppresses every unstable API warning in the matching files, including warnings
from newly introduced APIs. Review those dependencies when adding an API or upgrading Effect,
and run the type, runtime, and packed-consumer checks on each upgrade.

## Consequences

Before `1.0`, breaking public changes raise the minor version and compatible changes raise the
patch. An Effect-only upgrade may raise the patch when the public API remains compatible. The
project keeps a changelog from its first release. Before publishing `1.0`, it evaluates the stability
of the upstream RPC and HTTP APIs. The Effect package's stable version alone does not establish
the stability of those APIs.
