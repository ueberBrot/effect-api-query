# Centralize the toolchain in Vite+

Status: Accepted.

## Context

Parallel configuration stacks would let formatting, linting, type checking, tests, and packaging
drift apart.

## Decision

Centralize those tasks in Vite+'s `vite.config.ts` and integrated tools. Keep separate tools only for
capabilities Vite+ does not own, such as Astro diagnostics, Effect-aware test helpers, full-process
browser tests, public compiler fixtures, and release management.

## Consequences

Library development uses TypeScript 7 with matching Effect diagnostics. Public declarations are
also checked with TypeScript 5.9. The documentation package may use a compiler supported by Astro.
Native package validation remains part of the build; dependency-update automation remains deferred.
