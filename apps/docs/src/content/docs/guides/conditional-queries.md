---
title: Conditional Queries
description: Pause queries until their required input is available.
---

Use `{ input: skipToken }` when a payload-bearing query has no valid input yet and needs TanStack
options such as `staleTime`, `select`, or `initialData`:

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

The export preserves the identity of Query Core’s sentinel. A skipped query uses the RPC’s query
operation prefix as its key and contains no unconstructed payload. The builder preserves caller
options and their selected-data types. It consumes `input` before returning the options to TanStack.
Supplied `initialData` remains available, but React Query types skipped hook data as possibly
`undefined`, even with an initial value, because its defined-data overload excludes `skipToken`.

The sentinel applies to payload-bearing `queryOptions`, `infiniteOptions`, `streamedOptions`, and
`liveOptions`. Payloadless operations run without input, and key and mutation builders do not accept
`skipToken`. TanStack suspense and prefetch-only hooks also reject skipped options at the type level.

Unary `queryOptions` accepts an input that may be either a payload or `skipToken`. Keep that
condition inside one builder call so the observer has one consistent callback type. Concrete inputs
and literal `skipToken` keep their precise key types.

The object form also works for accumulated streams and live queries:

```ts
rpcQuery.events.watch.streamedOptions({
  input: skipToken,
  refetchMode: 'append',
  staleTime: 30_000,
})
rpcQuery.events.watch.liveOptions({ input: skipToken, select: (value) => value.length })
```

`refetchMode` configures accumulation and is consumed even when the query is skipped. Infinite
queries use `{ input: skipToken }` with their required `initialPageParam` and `getNextPageParam`.

When no caller options are needed, `queryOptions(skipToken)`, `streamedOptions(skipToken)`, and
`liveOptions(skipToken)` remain available as shorthand. A skipped query has no executable query
function; supply valid input to enable it.

Try this in either [executable example](/effect-rpc-query/examples/#pause-a-query-until-a-user-is-selected).
The **Choose before fetching** control demonstrates pausing, selecting a user, and reusing fresh
cached data after clearing and reselecting the same user.
