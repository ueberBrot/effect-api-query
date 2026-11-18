---
title: Vue Query
description: Rebuild generated options with Vue computed and keep client resources alive.
---

Install `VueQueryPlugin` and acquire your Effect client before passing generated options to Vue Query.

See [compatibility](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) for Vue requirements and tested versions.

## Rebuild options when input changes

Call the builder inside Vue `computed` so reactive changes produce a new key and function. An options object built once keeps its original input.

Keep [captured input](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) unchanged while options can run.

In component setup, use `rpc` from your [ready client](/effect-api-query/getting-started/quick-start/). Here `users.read` returns a user with a name.

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

Pass the computed value to the hook.

```ts
const user = useQuery(options);
```

Read the selected value from `user.data.value`. The hook infers the selected value and execution error types.

Use the same computed pattern for pages, streams, and HTTP metadata. For a write, pass `rpc.users.write.mutationOptions()` to `useMutation`. Pass each input to `mutate(variables)`. Use `computed` for mutation settings that depend on state.

## Choose native options carefully

Vue calls a function-valued `enabled` with no arguments. Set a boolean in computed options or use a zero-argument getter. Adapt Core's `enabled(query)` before using it in Vue.

An initializer that can return `undefined` yields optional data. Plain options with a defined seed keep the data type defined. Vue's computed overload can keep the type optional even with a defined seed. Pass `initialData: undefined` to clear an inherited seed.

## Own the native integration

Use one resolved Query Core version and a compiler that Vue supports. Follow [cache and client lifetime](/effect-api-query/integrations/#own-the-cache-and-client-lifetime) when you dispose of the client or replace an owner.
