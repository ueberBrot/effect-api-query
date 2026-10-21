---
title: Angular Query
description: Rebuild generated options from Angular signals and keep client lifetime in the application.
---

Build options inside Angular's reactive accessor. When input changes, the accessor creates a new key and query function. Use this pattern with either factory and every generated query view.

The examples target Angular 22.2.1 with Angular Query experimental 5.104.0 and Query Core 5.104.0.

Keep [captured inputs unchanged](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) while their options can execute.

## Create queries in an injection context

Register `provideTanStackQuery(queryClient)` in your application providers. Create queries inside an Angular injection context. Read each signal inside the accessor passed to `injectQuery`. Create `rpc` from your [ready client](/effect-api-query/getting-started/quick-start/). In this example, `users.read` accepts `{ id: number }` and returns a user with `name`. Import `signal` from `@angular/core` and `injectQuery` from `@tanstack/angular-query-experimental`. Add these field initializers to an existing component:

```ts
readonly id = signal(1)
readonly user = injectQuery(() =>
  rpc.users.read.queryOptions({
    input: { id: this.id() },
    select: (user) => user.name,
  }),
)
```

For pagination, use `injectInfiniteQuery` with `infiniteOptions`. For writes, use `injectMutation` with `mutationOptions`. Supply each mutation's input through its execution variables. Angular query results expose signals such as `data()`, `error()`, and `fetchStatus()`.

Use the same accessor for `streamedOptions`, `liveOptions`, and HTTP `metadataOptions`.

## Choose native options carefully

Angular's defined-data overload accepts a query function and excludes `skipToken`. A skipped query therefore retains `undefined` in its `data()` type, even with defined `initialData`. An initial-data function that can return `undefined` also produces optional result data.

## Own the native integration

Follow the [shared integration lifetime](/effect-api-query/integrations/#own-the-cache-and-client-lifetime) for providers, observer removal, stream finalizers, and accepted mutations. Match the native wrapper to the application's Query Core. Use a compiler and tooling that Angular supports.

Use the same Angular release for core, common, compiler, and platform-browser. The application owns server rendering and hydration.
