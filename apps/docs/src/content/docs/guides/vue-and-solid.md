---
title: Vue and Solid Query
description: Rebuild generated options from reactive input and keep client resources alive.
---

Pass generated options from either factory to the framework's native Query hooks. Configure
`VueQueryPlugin` in Vue or `QueryClientProvider` in Solid, and acquire the ready client before
creating the utilities. Keep its `Scope` and any serviceful runner alive while queries use them.

| Framework | Framework version | Query wrapper and matching Query Core |
| --------- | ----------------- | ------------------------------------- |
| Vue       | 3.5.43            | 5.103.1 and 5.104.0                   |
| Solid     | 1.9.15            | 5.103.1 and 5.104.0                   |

These combinations use Effect 4.0.0 with strict TypeScript 5.9.3 and 7.0.2. The same generated
builders provide selection, defined initial data, skipping, mutations, pagination, accumulated
streams, live values, and HTTP metadata views. See the
[compatibility reference](/effect-api-query/reference/compatibility-and-limits/) for the wider scope.

## Rebuild options when input changes

Builders capture plain input when called. Build options inside Vue `computed` or Solid's options
accessor so a changed input produces a new key and query function. Passing a builder's result
once leaves the query attached to the original input.

In Vue component setup, use a computed options object. This example assumes `rpc.users.read`
returns a user with a `name`:

```ts
import type { InferDataFromTag, InferErrorFromTag } from '@tanstack/query-core'
import { useQuery } from '@tanstack/vue-query'
import { skipToken } from 'effect-api-query'
import { computed, ref } from 'vue'

const userId = ref<number | undefined>(1)
const options = computed(() =>
  rpc.users.read.queryOptions({
    input: userId.value === undefined ? skipToken : { id: userId.value },
    select: (user) => user.name,
  }),
)
const user = useQuery<
  InferDataFromTag<unknown, typeof options.value.queryKey>,
  InferErrorFromTag<Error, typeof options.value.queryKey>,
  string
>(options)
```

Read the selected value from `user.data.value`. The explicit native hook generics preserve the
data and error carried by the generated key while bounding Vue's recursive ref unwrapping.
Automatic inference can otherwise exceed TypeScript's instantiation depth when it unwraps an
Effect `Cause` through a tagged key. Let the builder infer its arguments; put these type arguments
on the Vue hook.

In a Solid component, pass the builder call as an accessor:

```ts
import { useQuery } from '@tanstack/solid-query'
import { skipToken } from 'effect-api-query'
import { createSignal } from 'solid-js'

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

## Choose native options carefully

Vue evaluates a function-valued `enabled` as a getter with no arguments. Use a boolean inside
computed options, or a zero-argument getter returning a boolean. A Core `enabled(query)` callback
cannot be passed directly to Vue. Solid accepts the native Core callback.

The pinned Solid query and infinite-query overloads accept defined initial data or absent initial
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
