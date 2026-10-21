# Centralize the toolchain in Vite+

Status: Accepted.

## Context

Separate configuration stacks can let formatting, linting, type checking, tests, and packaging drift apart.

## Decision

Centralize these tasks in Vite+'s `vite.config.ts` and integrated tools. Keep separate tools only for capabilities that Vite+ does not own. These include Astro diagnostics, Effect-aware test helpers, full-process browser tests, public compiler fixtures, and release management.

## Consequences

Library development uses TypeScript 7 with matching Effect diagnostics. Checks of public declarations also use TypeScript 5.9. The documentation package can use a compiler that Astro supports. Native package validation remains part of the build. Dependency-update automation remains deferred.
