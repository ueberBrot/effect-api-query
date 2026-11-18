---
title: Solid Query
description: Rebuild generated options with a Solid accessor and keep client resources alive.
---

Configure `QueryClientProvider` and acquire your Effect client before passing generated options to Solid Query.

See [compatibility](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) for Solid requirements and tested versions.

## Rebuild options when input changes

Call the builder from Solid's options accessor so input changes produce a new key and function. A previously built object keeps the input it captured.

Keep [captured input](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged) unchanged while options can run.

Use `rpc` from your [ready client](/effect-api-query/getting-started/quick-start/) in component setup. Here `users.read` takes an ID and returns a user.

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

Read the selected value from `user.data`. Use the same accessor for pages, streams, and metadata. For writes, use `useMutation(() => rpc.users.write.mutationOptions())` and pass variables to `mutate`. Read any reactive mutation settings inside the accessor.

## Choose native options carefully

Solid accepts Core's `enabled(query)` callback. In the tested versions, omit `initialData` or supply a defined seed for query and infinite-query overloads. A value or initializer that can return `undefined` does not match. An explicit `initialData: undefined` clears inherited initial data.

## Own the native integration

Use one resolved Query Core version and a compiler that Solid supports. Follow [cache and client lifetime](/effect-api-query/integrations/#own-the-cache-and-client-lifetime) for observer removal and cleanup.
