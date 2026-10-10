---
title: Angular Query
description: Rebuild generated options from Angular signals and keep client lifetime in the application.
---

Pass generated options through the framework's reactive accessor. Each builder captures its
plain input when called, so create the options inside that accessor whenever the input can change.
The same rule applies to RPC and HTTP queries, metadata views, accumulated streams, and live queries.

The examples target Angular 22.2.1 with Angular Query experimental 5.104.0 and Query Core 5.104.0.

Keep captured values unchanged while their options can execute. See
[Data Normalization](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
for the distinction between immutable keys and caller-owned input.

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

Use the same accessor for `streamedOptions`, `liveOptions`, and HTTP `metadataOptions`. These
provide accumulated history, the latest emission, and decoded data with status/header snapshots,
respectively.

## Choose native options carefully

Angular's defined-data overload accepts a query function rather than `skipToken`. A skipped query
therefore retains `undefined` in its `data()` type even when it has defined `initialData`. An
initial-data function that may return `undefined` also produces optional result data.

## Own the lifecycle

Open streams expose their first value while fetching continues. Changing a generated query's key
replaces the observer's active query. Destroying an Angular component removes its observers;
the last observer of an abort-aware open stream triggers
cancellation. Keep the ready client and runtime alive until local stream finalizers finish.
Other observers of the same query retain their subscription.

For an owner change, unmount the old tree, cancel and clear its QueryClient, await local cleanup,
then dispose its client resources. Mount the new tree with independently owned resources and a
safe key prefix. See [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/) and
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/).

Match Angular Query to the application's Query Core and use a compiler supported by its build
tooling. Angular core, common, compiler, and platform-browser should share one release.
Server rendering and hydration remain application integrations.
