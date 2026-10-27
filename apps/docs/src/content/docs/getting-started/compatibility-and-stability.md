---
title: Compatibility and Stability
description: Check dependency requirements, tested integrations, module format, and the release policy.
---

Import both factories from the `@ueberbrot/effect-api-query` package root. They use the same peer dependencies. Check your installed package's manifest for its peer requirements. See [Requirements and tested integrations](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) for library peers, native framework requirements, and exact checked versions.

For the 0.4 upgrade, follow [Migrate to 0.4](/effect-api-query/guides/migrate-to-0-4/).

This website documents the package version shown in its header. The repository's `main` branch can contain unreleased changes.

The package is ESM-only and targets ES2022. Enable strict TypeScript checking.

The tested Effect release is stable. Its RPC and HTTP API modules declare unstable APIs, so the package pins one exact Effect peer version. Use compatible Effect runtime, testing, and platform packages that match that version. Before changing those packages, read the peer requirements and tested integrations for the selected `effect-api-query` release.

Query Core's streamed-query interface is experimental and can change between v5 releases. Pin Query packages to the checked versions and keep the native wrapper's resolved Core version aligned with the application. Consult the compatibility table before upgrading.

Choose the [RPC quick start](/effect-api-query/getting-started/quick-start/) or [HTTP quick start](/effect-api-query/getting-started/http-quick-start/) for your declaration.
