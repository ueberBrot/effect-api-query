---
title: Vue Query
description: Rebuild generated options with Vue computed and keep client resources alive.
---

Pass generated options from either factory to Vue Query's native hooks. Configure `VueQueryPlugin`
and acquire the ready client before creating the utilities.

The examples target Vue 3.5.43 with Vue Query 5.104.0 and Query Core 5.104.0.

## Rebuild options when input changes

Builders capture plain input when called. Build options inside Vue `computed` so a changed input
produces a new key and query function. Passing a builder's result once leaves the query attached
to the original input.

Keep [captured inputs unchanged](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
while their options can execute.

In component setup, use the `rpc` tree from your [ready client](/effect-api-query/getting-started/quick-start/).
Here `users.read` returns a user with a `name`:

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
```

In the same component setup, pass the tagged types to the native hook:

```ts
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

Apply the same computed pattern to `infiniteOptions`, `streamedOptions`, `liveOptions`, and
`metadataOptions` when their input changes. Pass `rpc.users.write.mutationOptions()` to
`useMutation` and supply each execution's input through `mutate(variables)`. Use `computed`
when mutation settings depend on reactive state.

## Choose native options carefully

Vue evaluates a function-valued `enabled` as a getter with no arguments. Use a boolean inside
computed options, or a zero-argument getter returning a boolean. A Core `enabled(query)` callback
cannot be passed directly to Vue.

Vue accepts an initial-data initializer that may return `undefined`, with optional result data.
An explicit `initialData: undefined` overrides inherited QueryClient initial data.

## Own streams and disposal

Changing input or unmounting removes an observer. An abort-aware open stream cancels when its
last observer leaves; other observers keep it active. Keep clients alive until local finalizers
and accepted mutations settle. Follow
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for disposal and
[Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/) for owner replacement.
Transport interruption depends on the ready client.

Match Vue Query to the application's Query Core and use a compiler supported by Vue's tooling.
