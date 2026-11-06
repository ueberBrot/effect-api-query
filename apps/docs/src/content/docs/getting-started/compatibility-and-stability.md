---
title: Compatibility and Stability
description: Check dependency requirements, tested integrations, module format, and the release policy.
---

Import both factories from the `@ueberbrot/effect-api-query` package root. They use the same peer dependencies. Check your installed package's manifest for its peer requirements. See [Requirements and tested integrations](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) for library peers, native framework requirements, and exact checked versions.

This website documents the package version shown in its header. The repository's `main` branch can contain unreleased changes.

The package is ESM-only and targets ES2022. Enable strict TypeScript checking.

Effect is stable, while its RPC and HTTP API modules declare unstable APIs. The published Effect peer range is `>=4.0.6 <4.2.0`. Keep the application's Effect runtime, testing, and platform packages on a coordinated release within that range. Exact development pins are separate: this repository uses `4.1.0` and checks it alongside the supported `4.0.6` floor.

The package raises its minimum when it needs a newer API, type contract, or correctness fix. Otherwise it retains the floor and widens support only after checking upstream changes, public types, execution, cancellation, hydration, builds, and relevant consumers. Checks cover the floor and current development release rather than every intermediate patch. Effect 4.2 and later minors require another compatibility review. Supporting an older release does not backport upstream transport fixes.

Query Core's streamed-query interface is experimental and can change between v5 releases. Pin Query packages to the checked versions and keep the native wrapper's resolved Core version aligned with the application. Consult the compatibility table before upgrading.

Choose the [RPC quick start](/effect-api-query/getting-started/quick-start/) or [HTTP quick start](/effect-api-query/getting-started/http-quick-start/) for your declaration.
