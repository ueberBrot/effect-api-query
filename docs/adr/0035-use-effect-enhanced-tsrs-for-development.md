# Use Effect-enhanced TSRS for development

Status: Accepted. Amends the development compiler selection in [ADR 0015](0015-centralize-the-toolchain-in-vite-plus.md); its Vite+ task boundary remains accepted.

## Decision

Pin `@effect/tsgo` to `0.67.3` and explicitly select its bundled TSRS `0.21.0-ts7.1.0-beta` (TypeScript language target `7.1.0-beta`, Microsoft revision `3e9236361fa9`). Use this engine for development checks, Effect diagnostics, public/current consumer fixtures, declaration emission, and the ordinary TypeScript language server. Type-aware Oxlint uses the same TSRS backend through the Effect wrapper. Preserve rule settings, strict compiler options, and warning/error failure exits. Suggestions retain their configured nonfatal compiler behavior.

The [published tooling README](https://github.com/Effect-TS/tsgo/tree/%40effect%2Ftsgo%400.67.3) supports this TSRS build and Oxlint 1.89.0. The [npm publication metadata](https://registry.npmjs.org/@effect%2ftsgo) records `0.67.3` at 2026-11-05 09:43:40 UTC, eligible after 2026-11-12 09:43:40 UTC under [ADR 0017](0017-quarantine-new-dependency-releases-for-seven-days.md). The bundled compiler and libraries come from that exact distribution; commands never select `latest` or an implicit installed compiler.

Retain TypeScript 5.9.3 for minimum-consumer checks and JavaScript compiler API consumers. Astro retains its separately pinned 6.0.3 compiler API. These roles do not choose the development engine. The lockfile still contains TypeScript 7.0.2 solely because optional `fallow-type-aware@3.37.0` requires it. This upstream requirement remains a limitation; do not override it or treat its presence as the development compiler selection.

## Consequences

Vite+ remains the task interface. Preparation verifies the pinned bundled engine without rewriting installed compiler binaries. The editor SDK launcher and declaration generator invoke that engine explicitly. Declaration emission has a source-only project; root type and lint checks continue to cover fixtures, applications, tests, and scripts.

See [the contributor toolchain procedure](../agents/toolchain.md) for editor setup and validation limits. TSRS and its lint backend remain experimental upstream. A CLI check alone does not establish editor, lint, or declaration parity; keep separate checks for each integration. No consumer compiler minimum changes.
