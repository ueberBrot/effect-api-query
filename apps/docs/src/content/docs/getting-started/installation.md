---
title: Installation
description: Install effect-api-query and its peer dependencies.
---

Install the package with Effect and TanStack Query Core:

```sh
pnpm add effect-api-query effect@4.0.0-rc.112 @tanstack/query-core@^5.102.0
```

React applications also need the React adapter:

```sh
pnpm add @tanstack/react-query@^5.102.0
```

Use TypeScript 5.9 or newer with `strict: true` in your `tsconfig.json`. Your application must support
ESM and ES2022.

Continue with the [RPC quick start](/effect-rpc-query/getting-started/quick-start/) or
[HTTP queries and mutations](/effect-rpc-query/guides/http-queries-and-mutations/). Before adopting
the package, review [compatibility and stability](/effect-rpc-query/getting-started/compatibility-and-stability/).
