---
title: Svelte and Angular
description: Rebuild generated options when reactive inputs change and keep client lifetime in the application.
---

Pass generated options through the framework's reactive accessor. Each builder captures its
plain input when called, so create the options inside that accessor whenever the input can change.
The same rule applies to RPC and HTTP queries, metadata views, accumulated streams, and live queries.

Keep captured values unchanged while their options can execute. See
[Data Normalization](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
for the distinction between immutable keys and caller-owned input.

## Svelte

Create the utility tree in your application module from an acquired ready client. Provide a
QueryClient through Svelte Query's `QueryClientProvider`, then read reactive inputs inside the
accessor passed to `createQuery`:

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

<button onclick={() => id += 1}>Next user</button>
<p>{user.data}</p>
```

Use `createInfiniteQuery(() => rpc.users.list.infiniteOptions(...))` for pagination and
`createMutation(() => rpc.users.write.mutationOptions(...))` for writes. A mutation's variables
provide the input for each execution. Mutation options can be static when their callbacks and
other settings do not depend on reactive state.

Compile the Svelte application with `module: "ESNext"` and `moduleResolution: "Bundler"`.
The supported Svelte Query releases require this resolution for their emitted `.svelte`
declarations; strict NodeNext declaration checking reports an upstream `Box` import error.

## Angular

Register `provideTanStackQuery(queryClient)` in your application providers. Construct queries
inside an Angular injection context and read the signal inside the accessor passed to `injectQuery`.
The ready client below is acquired and disposed by the application:

```ts
import { Component, signal } from '@angular/core'
import { injectQuery } from '@tanstack/angular-query-experimental'
import { Schema } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcGroup, type RpcClient } from 'effect/rpc'

const group = RpcGroup.make(
  Rpc.make('users.read', {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  }),
)
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ['current-owner'] })

@Component({
  selector: 'user-details',
  standalone: true,
  template: '<button (click)="next()">Next user</button><p>{{ user.data() }}</p>',
})
class UserDetails {
  readonly id = signal(1)
  readonly user = injectQuery(() =>
    rpc.users.read.queryOptions({
      input: { id: this.id() },
      select: (user) => user.name,
    }),
  )

  next() {
    this.id.update((id) => id + 1)
  }
}
```

Use `injectInfiniteQuery` and `injectMutation` with the corresponding builders. Angular query
results expose signals such as `data()`, `error()`, and `fetchStatus()`.

Angular's defined-data overload accepts a query function rather than `skipToken`. A skipped query
therefore retains `undefined` in its `data()` type even when it has defined `initialData`. Svelte
preserves the defined-data type for that combination. Both frameworks accept initial-data functions
that may return `undefined`, with optional result data.

## Own the lifecycle

Changing a generated query's key replaces the observer's active query. Unmounting a Svelte
component or destroying an Angular component removes its observers; the last observer of an
abort-aware open stream triggers cancellation. Keep the ready client and runtime alive until
local stream finalizers finish. Other observers of the same query retain their subscription.

For an owner change, unmount the old tree, cancel and clear its QueryClient, await local cleanup,
then dispose its client resources. Mount the new tree with independently owned resources and a
safe key prefix. See [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/) and
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/).

## Version boundaries

| Framework | Framework release | Query integration                  | Matching Query Core |
| --------- | ----------------- | ---------------------------------- | ------------------- |
| Svelte    | 5.57.1            | Svelte Query 6.2.1                 | 5.103.1             |
| Svelte    | 5.57.1            | Svelte Query 6.3.0                 | 5.104.0             |
| Angular   | 22.2.1            | Angular Query experimental 5.103.1 | 5.103.1             |
| Angular   | 22.2.1            | Angular Query experimental 5.104.0 | 5.104.0             |

Angular core, common, compiler, and platform-browser use the same release, with RxJS 7.8.2.
The published option contract supports TypeScript 5.9.3 and 7.0.2 with strict checking; choose a
compiler release supported by your framework's build tooling. Framework query wrappers
must share the application's Query Core version. This scope covers browser components; framework
server rendering and hydration need their own application integration.
