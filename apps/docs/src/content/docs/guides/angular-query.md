---
title: Angular Query
description: Rebuild generated options from Angular signals and keep client lifetime in the application.
---

Build generated options inside Angular's reactive accessor so input changes produce a new key
and query function. This applies to both factories and every generated query view.

The examples target Angular 22.2.1 with Angular Query experimental 5.104.0 and Query Core 5.104.0.

Keep [captured inputs unchanged](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
while their options can execute.

## Create queries in an injection context

Register `provideTanStackQuery(queryClient)` in your application providers. Construct queries
inside an Angular injection context and read the signal inside the accessor passed to `injectQuery`.
Create `rpc` from your [ready client](/effect-api-query/getting-started/quick-start/).
Here `users.read` accepts `{ id: number }` and returns a user with `name`.
In an existing component's field initializers, with `signal` from `@angular/core` and
`injectQuery` from `@tanstack/angular-query-experimental`:

```ts
readonly id = signal(1)
readonly user = injectQuery(() =>
  rpc.users.read.queryOptions({
    input: { id: this.id() },
    select: (user) => user.name,
  }),
)
```

Use `injectInfiniteQuery` with `infiniteOptions` and `injectMutation` with `mutationOptions`.
Supply each mutation's input through its execution variables. Angular query results expose
signals such as `data()`, `error()`, and `fetchStatus()`.

Use the same accessor for `streamedOptions`, `liveOptions`, and HTTP `metadataOptions`.

## Choose native options carefully

Angular's defined-data overload accepts a query function rather than `skipToken`. A skipped query
therefore retains `undefined` in its `data()` type even when it has defined `initialData`. An
initial-data function that may return `undefined` also produces optional result data.

## Own the native integration

Follow the [shared integration lifetime](/effect-api-query/integrations/#own-the-cache-and-client-lifetime)
for providers, observer removal, stream finalizers, and accepted mutations. Match this native
wrapper to the application's Query Core and the framework's supported compiler/tooling.

Angular core, common, compiler, and platform-browser should share one release. Server rendering
and hydration remain application integrations.
