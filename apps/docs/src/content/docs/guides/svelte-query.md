---
title: Svelte Query
description: Rebuild generated options from Svelte reactive input and keep client lifetime in the application.
---

Call the builder inside Svelte's reactive accessor. When input changes, the accessor creates a new key and query function. The pattern works for either adapter.

See [compatibility](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) for Svelte requirements and tested versions.

Keep [captured input](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) unchanged while options can run.

## Create native queries

Create the utilities from your acquired client and pass the QueryClient to Svelte Query's `QueryClientProvider`. Read reactive values inside the `createQuery` accessor. Keep the client and runner alive while queries use them. This component's `users.read` takes an ID and returns a user.

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

For pages, use `createInfiniteQuery(() => rpc.users.list.infiniteOptions(...))`. For writes, use `createMutation(() => rpc.users.write.mutationOptions(...))`. Pass variables to each mutation. Keep mutation options static if their callbacks and settings do not depend on state.

Use the same accessor for `streamedOptions`, `liveOptions`, and HTTP `metadataOptions`.

## Choose native options carefully

With defined `initialData`, a skipped query keeps the defined-data type. If the initializer can return `undefined`, the result data is optional.

Use `module: "ESNext"` and `moduleResolution: "Bundler"` for the Svelte app. The tested Svelte Query declarations need Bundler resolution for `.svelte` files. Strict NodeNext checking reports an upstream `Box` import error.

## Own the native integration

Keep the app and Svelte Query on one resolved Query Core version. Use a compiler Svelte supports. See [cache and client lifetime](/effect-api-query/integrations/#own-the-cache-and-client-lifetime) for cleanup and [hydration](/effect-api-query/guides/hydrate-unary-data/) for server rendering.
