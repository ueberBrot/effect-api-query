---
title: Compatibility and Stability
description: Check supported integrations, module format, and the release policy.
---

Both factories use the same public `effect-api-query` package root and peer dependencies.
The package's [manifest](https://github.com/ueberBrot/effect-api-query/blob/main/package.json)
defines peer requirements; the [workspace catalog](https://github.com/ueberBrot/effect-api-query/blob/main/pnpm-workspace.yaml)
records versions exercised by this repository. See the
[compatibility reference](/effect-api-query/reference/compatibility-and-limits/) for how these
requirements are tested.

The package is ESM-only and targets ES2022. Enable strict TypeScript checking. The package has not
had its first release, so breaking changes remain possible. Review the release notes when upgrading.
Query Core's streamed-query interface is experimental and may change between v5 releases.

Choose the [RPC quick start](/effect-api-query/getting-started/quick-start/) or
[HTTP quick start](/effect-api-query/getting-started/http-quick-start/) for your declaration.
