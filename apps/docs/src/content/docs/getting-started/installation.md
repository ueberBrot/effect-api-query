---
title: Installation
description: Install effect-api-query and its peer dependencies.
---

Install the package and TanStack Query Core.

```sh
pnpm add @ueberbrot/effect-api-query @tanstack/query-core
```

The package supports Effect `>=4.1.4 <4.2.0` and Query Core `>=5.107.1 <6`. With automatic peer installation enabled, pnpm installs a compatible Effect version. If your app pins Effect, keep its runtime, testing, and platform packages on matching versions in that range.

Use ESM, an environment that supports ES2022, and TypeScript with `strict: true`. See [compatibility and limits](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) for compiler and framework versions.

For React wiring, import `@ueberbrot/effect-api-query/react`. That subpath uses optional peers React `^18 || ^19` and React Query `>=5.107.1 <6`. The root entry point works without either package. Keep your app and wrapper on the same resolved Query Core version.

```sh
pnpm add @tanstack/react-query
```

Follow the [HTTP quick start](/effect-api-query/getting-started/http-quick-start/) or the [RPC quick start](/effect-api-query/getting-started/quick-start/).
