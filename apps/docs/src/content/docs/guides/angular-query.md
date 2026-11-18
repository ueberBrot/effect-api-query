---
title: Angular Query
description: Rebuild generated options from Angular signals and keep client lifetime in the application.
---

Build options in the accessor passed to `injectQuery`. When a signal changes, Angular can rebuild the key and function. This works for both factories.

See [compatibility](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) for supported Angular requirements and tested versions.

Keep [captured input](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) unchanged while the options can run.

## Create queries in an injection context

Register `provideTanStackQuery(queryClient)` in the app providers. Create `rpc` from your [ready client](/effect-api-query/getting-started/quick-start/). In an Angular injection context, read signals inside the `injectQuery` accessor. Import `signal` from `@angular/core` and `injectQuery` from `@tanstack/angular-query-experimental`. The example's `users.read` takes a numeric ID and returns a user. Use `select` to read the name.

```ts
readonly id = signal(1)
readonly user = injectQuery(() =>
  rpc.users.read.queryOptions({
    input: { id: this.id() },
    select: (user) => user.name,
  }),
)
```

Use `injectInfiniteQuery` with `infiniteOptions` for pages. Use `injectMutation` with `mutationOptions` for writes. Pass variables each time the mutation runs. Read query results with signals such as `data()`, `error()`, and `fetchStatus()`.

Use the same accessor for `streamedOptions`, `liveOptions`, and HTTP `metadataOptions`.

## Choose native options carefully

A query with `skipToken` can have `undefined` data in Angular even if it has defined `initialData`. The defined-data overload requires a function. An initializer that can return `undefined` also yields optional data.

## Own the native integration

Use one resolved Query Core version and a compiler Angular supports. Follow [cache and client lifetime](/effect-api-query/integrations/#own-the-cache-and-client-lifetime) when observers leave or the app shuts down.

Use the same Angular release for core, common, compiler, and platform-browser. Handle server rendering and hydration in the app.
