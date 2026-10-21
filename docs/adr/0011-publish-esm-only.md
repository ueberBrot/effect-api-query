# Publish ESM only

Status: Accepted.

## Context

Effect 4 is ESM-only. A CommonJS build introduces a separate interoperability contract while the dependency graph still requires ESM.

## Decision

The package publishes side-effect-free ES2022 ESM through one root export. Public barrels list named exports and avoid `export *`. Framework and internal subpaths become exports only when they are intended for public use.

## Consequences

The package has no CommonJS build, uses no Node-only APIs, and declares no minimum Node version. If deployment requires it, applications can transform the complete dependency graph.
