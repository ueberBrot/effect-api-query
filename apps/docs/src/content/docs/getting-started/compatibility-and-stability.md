---
title: Compatibility and Stability
description: Check supported integrations, module format, and the release policy.
---

Import both factories from the `@ueberbrot/effect-api-query` package root. They use the same peer dependencies. Check your installed package's manifest for its peer requirements. See the [compatibility reference](/effect-api-query/reference/compatibility-and-limits/) for tested integration versions and limits.

This website documents the package version shown in its header. The repository's `main` branch can contain unreleased changes.

The package is ESM-only and targets ES2022. Enable strict TypeScript checking.

The tested Effect release is stable. Its RPC and HTTP API modules declare unstable APIs, so the package pins one exact Effect peer version. Use compatible Effect runtime, testing, and platform packages that match that version. Before changing those packages, read the peer requirements and tested integrations for the selected `effect-api-query` release.

Query Core's streamed-query interface is experimental and can change between v5 releases. Use framework Query wrappers that match your application's Query Core version.

Choose the [RPC quick start](/effect-api-query/getting-started/quick-start/) or [HTTP quick start](/effect-api-query/getting-started/http-quick-start/) for your declaration.
