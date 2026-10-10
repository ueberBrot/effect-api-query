---
title: Compatibility and Stability
description: Check supported integrations, module format, and the release policy.
---

Both factories use the same public `effect-api-query` package root and peer dependencies.
The package's [manifest](https://github.com/ueberBrot/effect-api-query/blob/main/package.json)
defines peer requirements; the [workspace catalog](https://github.com/ueberBrot/effect-api-query/blob/main/pnpm-workspace.yaml)
records the versions tested in this repository. See the
[compatibility reference](/effect-api-query/reference/compatibility-and-limits/) for how these
requirements are tested.

The package is ESM-only and targets ES2022. Enable strict TypeScript checking.

The tested Effect release is stable, but its RPC and HTTP API modules declare unstable APIs.
The package therefore pins one exact Effect peer version. Keep runtime, testing, and platform
packages on a compatible coordinated Effect set that matches it. Before changing that set, verify
the peer requirements and tested integrations of the selected package release.

Query Core's streamed-query interface is experimental and may change between v5 releases. Keep
framework Query wrappers aligned with their application's Query Core version.

Choose the [RPC quick start](/effect-api-query/getting-started/quick-start/) or
[HTTP quick start](/effect-api-query/getting-started/http-quick-start/) for your declaration.
