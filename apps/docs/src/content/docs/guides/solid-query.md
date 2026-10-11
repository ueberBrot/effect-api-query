---
title: Solid Query
description: Rebuild generated options with a Solid accessor and keep client resources alive.
---

Pass generated options from either factory to Solid Query's native hooks. Configure
`QueryClientProvider` and acquire the ready client before creating the utilities.

The examples target Solid 1.9.15 with Solid Query 5.104.0 and Query Core 5.104.0.

## Rebuild options when input changes

Builders capture plain input when called. Build options inside Solid's options accessor so a
changed input produces a new key and query function. Passing a builder's result once leaves the
query attached to the original input.

Keep [captured inputs unchanged](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
while their options can execute.

In component setup, use `rpc` from your [ready client](/effect-api-query/getting-started/quick-start/)
and pass the builder call as an accessor. Here `users.read` accepts an ID and returns a user
with `name`:

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

Read the selected value from `user.data`. Apply the same accessor pattern to `infiniteOptions`,
`streamedOptions`, `liveOptions`, and `metadataOptions` when their input changes. Use
`useMutation(() => rpc.users.write.mutationOptions())` for writes, supplying each execution's
input through `mutate(variables)`. Read reactive mutation settings inside the accessor.

## Choose native options carefully

Solid accepts Core's `enabled(query)` callback. Solid Query 5.104.0 query and infinite-query
overloads accept defined initial data or absent initial data. A value or initializer that may
return `undefined` does not match those overloads. Omit `initialData` or supply a defined seed.
An explicit `initialData: undefined` overrides inherited QueryClient initial data.

## Own streams and disposal

Changing input or disposing the Solid owner removes an observer. An abort-aware open stream
cancels when its last observer leaves; other observers keep it active. Keep clients alive until
local finalizers and accepted mutations settle. Follow
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for disposal and
[Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/) for owner replacement.
Transport interruption depends on the ready client.

Match Solid Query to the application's Query Core and use a compiler supported by Solid's tooling.
