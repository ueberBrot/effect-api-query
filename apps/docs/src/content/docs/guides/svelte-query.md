---
title: Svelte Query
description: Rebuild generated options from Svelte reactive input and keep client lifetime in the application.
---

Pass generated options through the framework's reactive accessor. Each builder captures its
plain input when called, so create the options inside that accessor whenever the input can change.
The same rule applies to RPC and HTTP queries, metadata views, accumulated streams, and live queries.

The examples target Svelte 5.57.1 with Svelte Query 6.3.0 and Query Core 5.104.0.

Keep captured values unchanged while their options can execute. See
[Data Normalization](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
for the distinction between immutable keys and caller-owned input.

## Create native queries

Create the utility tree in your application module from an acquired ready client. Provide a
QueryClient through Svelte Query's `QueryClientProvider`, then read reactive inputs inside the
accessor passed to `createQuery`. Keep the client's `Scope` and any serviceful runner alive while
queries use them. Here `users.read` accepts an ID and returns a user with `name`.
In the Svelte component script:

```svelte
<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query'
  import { rpc } from './api'

  let id = $state(1)
  const user = createQuery(() =>
    rpc.users.read.queryOptions({
      input: { id },
      select: (user) => user.name,
    }),
  )
</script>
```

Use `createInfiniteQuery(() => rpc.users.list.infiniteOptions(...))` for pagination and
`createMutation(() => rpc.users.write.mutationOptions(...))` for writes. A mutation's variables
provide the input for each execution. Mutation options can be static when their callbacks and
other settings do not depend on reactive state.

Use the same accessor for `streamedOptions`, `liveOptions`, and HTTP `metadataOptions`. These
provide accumulated history, the latest emission, and decoded data with status/header snapshots,
respectively.

## Choose native options carefully

A skipped query retains the defined-data type when it has defined `initialData`. An initial-data
function that may return `undefined` produces optional result data.

Compile the Svelte application with `module: "ESNext"` and `moduleResolution: "Bundler"`.
Svelte Query 6 requires this resolution for its emitted `.svelte` declarations; strict NodeNext
declaration checking reports an upstream `Box` import error.

## Own the lifecycle

Open streams expose their first value while fetching continues. Changing a generated query's key
replaces the observer's active query. Unmounting a Svelte component removes its observers;
the last observer of an abort-aware open stream triggers
cancellation. Keep the ready client and runtime alive until local stream finalizers finish.
Other observers of the same query retain their subscription.

For an owner change, unmount the old tree, cancel and clear its QueryClient, await local cleanup,
then dispose its client resources. Mount the new tree with independently owned resources and a
safe key prefix. See [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/) and
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/).

Match Svelte Query to the application's Query Core and use a compiler supported by its build
tooling. Server rendering and hydration remain application integrations.
