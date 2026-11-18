# effect-api-query

Use your Effect API with TanStack Query. This package builds typed options and cache keys from your RPC or HttpApi contract. Pass those options to a QueryClient or your framework's Query hooks. Keep the Effect client open while requests run.

This package is pre-1.0. Minor releases can include breaking changes.

## Install

```sh
pnpm add @ueberbrot/effect-api-query @tanstack/query-core
```

Use Effect `>=4.0.6 <4.2.0` and Query Core `>=5.104.4 <6`. See [installation](https://ueberbrot.github.io/effect-api-query/getting-started/installation/) for compiler and framework requirements.

## Fetch a user

Import `createHttpApiQueryUtils` from `@ueberbrot/effect-api-query`. Start with a `usersApi` that defines `users.get`. Acquire its HttpApiClient and create a QueryClient.

```ts
const http = createHttpApiQueryUtils(usersApi, {
  client,
  keyPrefix: ["users-app"],
});
const user = await queryClient.query(
  http.users.get.queryOptions({ input: { params: { id: 1 } } })
);
```

For client setup and cleanup, follow the [HTTP quick start](https://ueberbrot.github.io/effect-api-query/getting-started/http-quick-start/) or the [RPC quick start](https://ueberbrot.github.io/effect-api-query/getting-started/quick-start/).

## Documentation

- [Supported operations](https://ueberbrot.github.io/effect-api-query/getting-started/feature-support/) for reads, writes, pagination, and streams.
- [Framework integrations](https://ueberbrot.github.io/effect-api-query/integrations/) for hooks, providers, and server rendering.
- [Runnable examples](https://ueberbrot.github.io/effect-api-query/examples/) for Vite React and TanStack Start.
- [API reference](https://ueberbrot.github.io/effect-api-query/reference/public-exports/) for package exports.

## Agent skill

Install the usage skill from GitHub with the Skills CLI.

```sh
npx skills add ueberBrot/effect-api-query --full-depth --skill effect-api-query
```

The npm package includes the same skill. Run `npx @tanstack/intent@latest install` after you install the library. Enable `@ueberbrot/effect-api-query` to load the skill for your installed version.

```sh
npx @tanstack/intent@latest load @ueberbrot/effect-api-query#effect-api-query
```
