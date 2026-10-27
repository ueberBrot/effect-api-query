---
title: Vue Query
description: Rebuild generated options with Vue computed and keep client resources alive.
---

Pass options from either factory to Vue Query's native hooks. Before creating the utilities, configure `VueQueryPlugin` and acquire the ready client.

See [Requirements and tested integrations](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) for Vue Query's framework requirements and this guide's checked versions.

## Rebuild options when input changes

Builders capture plain input when you call them. Build options inside Vue `computed`. When input changes, the computed value contains a new key and query function. If you pass a builder's result once, the query keeps using the original input.

Keep [captured inputs unchanged](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) while their options can execute.

In component setup, use the `rpc` tree from your [ready client](/effect-api-query/getting-started/quick-start/). Here `users.read` returns a user with a `name`:

```ts
import { useQuery } from "@tanstack/vue-query";
import { skipToken } from "@ueberbrot/effect-api-query";
import { computed, ref } from "vue";

import { rpc } from "./queries.ts";

const userId = ref<number | undefined>(1);
const options = computed(() =>
  rpc.users.read.queryOptions({
    input: userId.value === undefined ? skipToken : { id: userId.value },
    select: (user) => user.name,
  })
);
```

Pass the computed options directly to the native hook:

```ts
const user = useQuery(options);
```

Read the selected value from `user.data.value`. Generated options infer the selected data and full execution-error union without explicit hook generics.

When input changes, use the same computed pattern for `infiniteOptions`, `streamedOptions`, `liveOptions`, and `metadataOptions`. For writes, pass `rpc.users.write.mutationOptions()` to `useMutation`. Supply each execution's input through `mutate(variables)`. If mutation settings depend on reactive state, use `computed`.

## Choose native options carefully

Vue evaluates a function-valued `enabled` as a getter with no arguments. Use a boolean inside computed options, or a zero-argument getter returning a boolean. A Core `enabled(query)` callback cannot be passed directly to Vue.

Vue accepts an initial-data initializer that can return `undefined`. Its result data is optional. Plain options with a defined seed preserve defined data. Vue's computed-options overload can keep data optional even with a defined seed; this follows the native hook's behavior. An explicit `initialData: undefined` overrides inherited QueryClient initial data.

## Own the native integration

Follow [the shared cache and client lifetime](/effect-api-query/integrations/#own-the-cache-and-client-lifetime) when disposing clients or replacing an owner. Match Vue Query to the application's Query Core and use a compiler supported by Vue's tooling.
