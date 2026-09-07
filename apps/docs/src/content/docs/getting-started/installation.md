---
title: Installation
description: Install effect-api-query and its peer dependencies.
---

Install the package and TanStack Query Core:

```sh
pnpm add effect-api-query @tanstack/query-core
```

With pnpm's default peer installation enabled, this also installs the exact Effect release required
by the package. If your application already pins Effect or disables automatic peer installation,
install the Effect version from the package's `peerDependencies` and resolve any peer mismatch
before continuing. The [package manifest](https://github.com/ueberBrot/effect-api-query/blob/main/package.json)
and [workspace catalog](https://github.com/ueberBrot/effect-api-query/blob/main/pnpm-workspace.yaml)
are the source for supported and tested versions.

React applications also need `@tanstack/react-query`, matching their Query Core version:

```sh
pnpm add @tanstack/react-query
```

Use strict TypeScript checking, ESM, and an ES2022-capable application. See the
[compatibility reference](/effect-api-query/reference/compatibility-and-limits/) for the tested
compiler and framework integrations.

Continue with the [RPC quick start](/effect-api-query/getting-started/quick-start/) or
[HTTP quick start](/effect-api-query/getting-started/http-quick-start/).
