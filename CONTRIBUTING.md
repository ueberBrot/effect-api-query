# Contributing

Use the repository's Dev Container to install the declared Node and pnpm versions with the frozen
workspace. Install Docker and a Dev Container client, open the repository, and choose **Dev
Containers: Reopen in Container** in VS Code.

The container forwards ports `3000`, `3001`, `4173`, and `5173` for the examples and previews.
See [Run the examples](https://ueberbrot.github.io/effect-api-query/examples/) to start an application.

## Validate changes

Run the complete validation suite from the repository root:

```sh
vp run validate
```

Run the documentation site with `vp run docs`. Check and build it with:

```sh
vp run docs-build
vp run docs-e2e
```

## Update dependencies

When updating Node, change both `.node-version` and the Dev Container image, then rebuild the
container. Rebuild it after changing the root `packageManager` value too.

For Query Core updates, follow [Maintain Query Core compatibility](./docs/maintaining-query-core.md).
