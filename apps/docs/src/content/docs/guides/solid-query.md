---
title: Solid Query
description: Rebuild generated options with a Solid accessor and keep client resources alive.
---

Pass options from either factory to Solid Query's native hooks. Before creating the utilities, configure `QueryClientProvider` and acquire the ready client.

See [Requirements and tested integrations](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) for Solid Query's framework requirements and this guide's checked versions.

## Rebuild options when input changes

Builders capture plain input when you call them. Build options inside Solid's options accessor. When input changes, the accessor creates a new key and query function. If you pass a builder's result once, the query keeps using the original input.

Keep [captured inputs unchanged](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) while their options can execute.

In component setup, use `rpc` from your [ready client](/effect-api-query/getting-started/quick-start/) and pass the builder call as an accessor. Here `users.read` accepts an ID and returns a user with `name`:

```ts
import { useQuery } from "@tanstack/solid-query";
import { skipToken } from "@ueberbrot/effect-api-query";
import { createSignal } from "solid-js";

import { rpc } from "./queries.ts";

const [userId] = createSignal<number | undefined>(1);
const user = useQuery(() => {
  const id = userId();
  return rpc.users.read.queryOptions({
    input: id === undefined ? skipToken : { id },
    select: (value) => value.name,
  });
});
```

Read the selected value from `user.data`. When input changes, use the same accessor pattern for `infiniteOptions`, `streamedOptions`, `liveOptions`, and `metadataOptions`. For writes, use `useMutation(() => rpc.users.write.mutationOptions())`. Supply each execution's input through `mutate(variables)`. Read reactive mutation settings inside the accessor.

## Choose native options carefully

Solid accepts Core's `enabled(query)` callback. With the checked versions, Solid Query's query and infinite-query overloads accept defined initial data or absent initial data. A value or initializer that can return `undefined` does not match those overloads. Omit `initialData` or supply a defined seed. An explicit `initialData: undefined` overrides inherited QueryClient initial data.

## Own the native integration

Follow the [shared integration lifetime](/effect-api-query/integrations/#own-the-cache-and-client-lifetime) for providers, observer removal, stream finalizers, and accepted mutations. Match the native wrapper to the application's Query Core. Use a compiler and tooling that Solid supports.
