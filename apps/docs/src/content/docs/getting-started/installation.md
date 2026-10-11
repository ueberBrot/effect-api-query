---
title: Installation
description: Install effect-api-query and its peer dependencies.
---

Install the package and TanStack Query Core:

```sh
pnpm add effect-api-query @tanstack/query-core
```

With pnpm's default peer installation enabled, this command also installs the exact Effect release that the package requires.
If your application already pins Effect or disables automatic peer installation, install the Effect version from the package's `peerDependencies`.
Resolve peer mismatches before continuing. The [package manifest](https://github.com/ueberBrot/effect-api-query/blob/main/package.json)
defines the peer requirements. The [workspace catalog](https://github.com/ueberBrot/effect-api-query/blob/main/pnpm-workspace.yaml)
lists the versions used in this repository.

For React, install `@tanstack/react-query` with a version that matches your Query Core version:

```sh
pnpm add @tanstack/react-query
```

Enable strict TypeScript checking and use ESM with ES2022 support. See the
[compatibility reference](/effect-api-query/reference/compatibility-and-limits/) for compiler and framework versions.

Continue with the [HTTP API quick start](/effect-api-query/getting-started/http-quick-start/) or
[RPC quick start](/effect-api-query/getting-started/quick-start/).
