---
title: Vue Query
description: Rebuild generated options with Vue computed and keep client resources alive.
---

Pass options from either factory to Vue Query's native hooks. Before creating the utilities,
configure `VueQueryPlugin` and acquire the ready client.

The examples target Vue 3.5.43 with Vue Query 5.104.0 and Query Core 5.104.0.

## Rebuild options when input changes

Builders capture plain input when you call them. Build options inside Vue `computed`.
When input changes, the computed value contains a new key and query function. If you pass a
builder's result once, the query keeps using the original input.

Keep [captured inputs unchanged](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
while their options can execute.

In component setup, use the `rpc` tree from your [ready client](/effect-api-query/getting-started/quick-start/).
Here `users.read` returns a user with a `name`:

```ts
import { useQuery } from '@tanstack/vue-query'
import { skipToken } from 'effect-api-query'
import type { InferQueryData, InferQueryError } from 'effect-api-query'
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

In the same component setup, infer the leaf's cache data and error types for the native hook:

```ts
const user = useQuery<
  InferQueryData<typeof rpc.users.read>,
  InferQueryError<typeof rpc.users.read>,
  string
>(options)
```

Read the selected value from `user.data.value`. The explicit native hook generics preserve the
leaf's data and error types while limiting Vue's recursive ref unwrapping.
Automatic inference can otherwise exceed TypeScript's instantiation depth when it unwraps an
Effect `Cause` through a tagged key. Let the builder infer its arguments. Put these type arguments
on the Vue hook.

When input changes, use the same computed pattern for `infiniteOptions`, `streamedOptions`,
`liveOptions`, and `metadataOptions`. For writes, pass `rpc.users.write.mutationOptions()` to
`useMutation`. Supply each execution's input through `mutate(variables)`. If mutation settings
depend on reactive state, use `computed`.

## Choose native options carefully

Vue evaluates a function-valued `enabled` as a getter with no arguments. Use a boolean inside
computed options, or a zero-argument getter returning a boolean. A Core `enabled(query)` callback
cannot be passed directly to Vue.

Vue accepts an initial-data initializer that can return `undefined`. Its result data is optional.
An explicit `initialData: undefined` overrides inherited QueryClient initial data.

## Own the native integration

Follow [the shared cache and client lifetime](/effect-api-query/integrations/#own-the-cache-and-client-lifetime)
when disposing clients or replacing an owner. Match Vue Query to the application's Query Core
and use a compiler supported by Vue's tooling.
