---
title: Solid Query
description: Rebuild generated options with a Solid accessor and keep client resources alive.
---

Pass generated options from either factory to Solid Query's native hooks. Configure
`QueryClientProvider` and acquire the ready client before creating the utilities. Keep its `Scope`
and any serviceful runner alive while queries use them.

The examples target Solid 1.9.15 with Solid Query 5.104.0 and Query Core 5.104.0.

Match the native Query wrapper to the application's Query Core and use a compiler supported by
the framework's tooling. See the
[compatibility reference](/effect-api-query/reference/compatibility-and-limits/) for adapter capabilities.

## Rebuild options when input changes

Builders capture plain input when called. Build options inside Solid's options accessor so a
changed input produces a new key and query function. Passing a builder's result once leaves the
query attached to the original input.

Keep captured values unchanged while their options can execute. See
[Data Normalization](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
for the distinction between immutable keys and caller-owned input.

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

Open streams expose their first value while fetching continues. Changing reactive input replaces
the query; when its last observer leaves, query cancellation closes the stream iterator. Solid
owner disposal also releases observed streams. Keep client resources alive until these queries
finish cancelling, then clear the owned QueryClient and close the client scope. Transport
interruption depends on the ready client.

Use `streamedOptions` for an accumulated history and `liveOptions` for its latest emission. HTTP
`metadataOptions` retains decoded data, response status, and header snapshots in a separate cache
entry. Follow [client lifecycle](/effect-api-query/concepts/client-lifecycle/) and
[cancellation](/effect-api-query/guides/cancellation/) when disposing the cache owner.
