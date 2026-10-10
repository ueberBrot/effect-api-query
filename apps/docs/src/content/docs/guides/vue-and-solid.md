---
title: Vue and Solid Query
description: Rebuild generated options from reactive input and keep client resources alive.
---

Pass generated options from either factory to the framework's native Query hooks. Configure
`VueQueryPlugin` in Vue or `QueryClientProvider` in Solid, and acquire the ready client before
creating the utilities. Keep its `Scope` and any serviceful runner alive while queries use them.

The examples target Vue 3.5.43 with Vue Query 5.104.0 and Solid 1.9.15 with Solid Query 5.104.0.
Both use Query Core 5.104.0.

Match the native Query wrapper to the application's Query Core and use a compiler supported by
the framework's tooling. See the
[compatibility reference](/effect-api-query/reference/compatibility-and-limits/) for adapter capabilities.

## Rebuild options when input changes

Builders capture plain input when called. Build options inside Vue `computed` or Solid's options
accessor so a changed input produces a new key and query function. Passing a builder's result
once leaves the query attached to the original input.

Keep captured values unchanged while their options can execute. See
[Data Normalization](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
for the distinction between immutable keys and caller-owned input.

In Vue component setup, use a computed options object. This example assumes `rpc.users.read`
returns a user with a `name`:

```ts
import type { InferDataFromTag, InferErrorFromTag } from '@tanstack/query-core'
import { useQuery } from '@tanstack/vue-query'
import { skipToken } from 'effect-api-query'
import { computed, ref } from 'vue'

import { rpc } from './queries.ts'

const userId = ref<number | undefined>(1)
const options = computed(() =>
  rpc.users.read.queryOptions({
    input: userId.value === undefined ? skipToken : { id: userId.value },
    select: (user) => user.name,
  }),
)
type UserKey = ReturnType<typeof rpc.users.read.queryKey>
const user = useQuery<
  InferDataFromTag<unknown, UserKey>,
  InferErrorFromTag<Error, UserKey>,
  string
>(options)
```

Read the selected value from `user.data.value`. The explicit native hook generics preserve the
data and error carried by the concrete generated key while bounding Vue's recursive ref unwrapping.
Automatic inference can otherwise exceed TypeScript's instantiation depth when it unwraps an
Effect `Cause` through a tagged key. Let the builder infer its arguments; put these type arguments
on the Vue hook.

In a Solid component, pass the builder call as an accessor:

```ts
import { useQuery } from '@tanstack/solid-query'
import { skipToken } from 'effect-api-query'
import { createSignal } from 'solid-js'

import { rpc } from './queries.ts'

const [userId] = createSignal<number | undefined>(1)
const user = useQuery(() => {
  const id = userId()
  return rpc.users.read.queryOptions({
    input: id === undefined ? skipToken : { id },
    select: (value) => value.name,
  })
})
```

Read the selected value from `user.data`. Apply the same computed/accessor pattern to
`infiniteOptions`, `streamedOptions`, `liveOptions`, and `metadataOptions` when their input changes.

Pass `rpc.users.write.mutationOptions()` to Vue's `useMutation`, or use
`useMutation(() => rpc.users.write.mutationOptions())` in Solid. Supply each execution's input
through `mutate(variables)`; use Vue `computed` or a Solid accessor when mutation settings depend
on reactive state.

## Choose native options carefully

Vue evaluates a function-valued `enabled` as a getter with no arguments. Use a boolean inside
computed options, or a zero-argument getter returning a boolean. A Core `enabled(query)` callback
cannot be passed directly to Vue. Solid accepts the native Core callback.

Solid Query 5.104.0 query and infinite-query overloads accept defined initial data or absent initial
data. A value or initializer that may return `undefined` does not match those overloads. Omit
`initialData` or supply a defined seed. Vue accepts a possibly undefined initializer. An explicit
`initialData: undefined` still overrides inherited QueryClient initial data in both integrations.

## Own streams and disposal

Open streams expose their first value while fetching continues. Changing reactive input replaces
the query; when its last observer leaves, query cancellation closes the stream iterator. Component
unmount or Solid owner disposal also releases observed streams. Keep client resources alive until
these queries finish cancelling, then clear the owned QueryClient and close the client scope.
Transport interruption depends on the ready client.

Use `streamedOptions` for an accumulated history and `liveOptions` for its latest emission. HTTP
`metadataOptions` retains decoded data, response status, and header snapshots in a separate cache
entry. Follow [client lifecycle](/effect-api-query/concepts/client-lifecycle/) and
[cancellation](/effect-api-query/guides/cancellation/) when disposing the cache owner.
