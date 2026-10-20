---
title: Svelte Query
description: Rebuild generated options from Svelte reactive input and keep client lifetime in the application.
---

Build options inside Svelte's reactive accessor. When input changes, the accessor creates a new key and query function. Use this pattern with either factory and every generated query view.

The examples target Svelte 5.57.1 with Svelte Query 6.3.0 and Query Core 5.104.0.

Keep [captured inputs unchanged](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) while their options can execute.

## Create native queries

Create the utility tree in your application module from an acquired ready client. Provide a QueryClient through Svelte Query's `QueryClientProvider`. Read reactive inputs inside the accessor passed to `createQuery`. Keep the client's `Scope` and any runner that supplies services alive while queries use them. Here, `users.read` accepts an ID and returns a user with `name`. Add the query to the Svelte component script:

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

For pagination, use `createInfiniteQuery(() => rpc.users.list.infiniteOptions(...))`. For writes, use `createMutation(() => rpc.users.write.mutationOptions(...))`. A mutation's variables provide the input for each execution. Mutation options can be static when their callbacks and other settings do not depend on reactive state.

Use the same accessor for `streamedOptions`, `liveOptions`, and HTTP `metadataOptions`.

## Choose native options carefully

A skipped query retains the defined-data type when it has defined `initialData`. An initial-data function that can return `undefined` produces optional result data.

Compile the Svelte application with `module: "ESNext"` and `moduleResolution: "Bundler"`. Svelte Query 6 requires this resolution for its emitted `.svelte` declarations. Strict NodeNext declaration checking reports an upstream `Box` import error.

## Own the native integration

Follow the [shared integration lifetime](/effect-api-query/integrations/#own-the-cache-and-client-lifetime) for providers, observer removal, stream finalizers, and accepted mutations. Match the native wrapper to the application's Query Core. Use a compiler and tooling that Svelte supports.

The application owns server rendering and hydration.
