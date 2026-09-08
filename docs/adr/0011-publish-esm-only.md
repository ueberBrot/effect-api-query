# Publish ESM only

Status: Accepted.

## Context

Effect 4 is ESM-only. A CommonJS build would create a separate interop contract without making the
dependency graph CommonJS-native.

## Decision

The package publishes side-effect-free ES2022 ESM through one root export. Public barrels enumerate
named exports and avoid `export *`. Framework and internal subpaths become exports only when they are
intended for public use.

## Consequences

There is no CommonJS build. The package uses no Node-only APIs and declares no minimum Node
version. Applications may transform the complete dependency graph when their deployment requires it.
