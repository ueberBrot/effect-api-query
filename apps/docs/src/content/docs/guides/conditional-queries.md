---
title: Conditional Queries
description: Pause queries until their required input is available.
---

In component setup, import the native `useQuery` hook. Use your application's ready utility tree,
named `rpcQuery` here. Its `users.get` RPC takes a numeric `id` with a default locale and returns a
user with an `id` and `name`. For factory setup, follow the
[RPC quick start](/effect-api-query/getting-started/quick-start/).

`userId` is the selected ID and can be undefined. If an input-bearing query has no valid input,
use `{ input: skipToken }`. The builder still accepts TanStack options such as `staleTime`,
`select`, or `initialData`:

```ts
import { skipToken } from 'effect-api-query'

type User = { id: number; name: string }

const displayOptions = { staleTime: 30_000, select: (user: User) => user.name }

const userOptions = rpcQuery.users.get.queryOptions({
  ...displayOptions,
  input: userId === undefined ? skipToken : { id: userId },
})

const user = useQuery(userOptions)
```

For an HTTP `users.get` endpoint that accepts only a numeric `id` param and returns a user,
the complete decoded request contains only `params`:

```ts
const httpUserOptions = http.users.get.queryOptions({
  input: userId === undefined ? skipToken : { params: { id: userId } },
  staleTime: 30_000,
  select: (user) => user.name,
})
```

The exported `skipToken` is Query Core's exact sentinel. A skipped query uses its operation
prefix as its key, without payload or request identity. A skipped HTTP query does not encode a
request or invoke the client. The builder preserves caller options and their selected-data types.
It removes `input` before returning the options to TanStack.

Supplied `initialData` remains available. React Query's `useQuery` still types skipped hook data as
possibly `undefined`, even with an initial value, because its defined-data overload excludes
`skipToken`. `useInfiniteQuery` preserves its defined-data overload when `initialData` is a defined
value or factory. This also applies to conditional and skipped inputs.

Both adapters accept the sentinel in input-bearing `queryOptions`, `infiniteOptions`,
`streamedOptions`, and `liveOptions`. Buffered HTTP `metadataOptions` also accepts it.
Inputless operations run without input. Key and mutation builders do not accept `skipToken`.
TanStack suspense and prefetch-only hooks reject skipped options at the type level.

`queryOptions`, `metadataOptions`, `streamedOptions`, and `liveOptions` accept concrete input,
`skipToken`, or a conditional union of both. Keep conditional input inside one builder call so the
observer has one consistent callback type. Concrete input and literal `skipToken` retain precise
key and query-function types. Conditional input preserves both possibilities.

If your RPC group also declares `events.watch` with a string `channel` input and string
emissions, build either view in that consumer:

```ts
rpcQuery.events.watch.streamedOptions({
  input: channel === undefined ? skipToken : { channel },
  refetchMode: 'append',
  staleTime: 30_000,
})
rpcQuery.events.watch.liveOptions({
  input: channel === undefined ? skipToken : { channel },
  select: (value) => value.length,
})
```

`refetchMode` configures accumulation. The builder removes it from the returned options, even for
skipped queries. Skipped streams still validate retention, refetch, and HTTP SSE decoder policies.
Infinite queries accept a page-to-input mapper, `skipToken`, or a conditional union of both.
They also require `initialPageParam` and `getNextPageParam`. Choose the mapper or sentinel in
`input`. Each mapper result must be valid input.

A skipped query has no executable query function, so manual `refetch()` cannot run it.
Supply valid input to enable the query. If you have a complete request and need manual refetch,
use `enabled: false`.

For HTTP pagination, map each page parameter to the complete request and keep stable filters in
every page. See [Load pages](/effect-api-query/guides/pagination/) for
initial-request identity and cursor progression.

Try this in either [executable example](/effect-api-query/examples/#pause-a-query-until-a-user-is-selected).
The **Choose before fetching** control pauses queries, selects a user, and reuses fresh
cached data after clearing and reselecting the same user.
