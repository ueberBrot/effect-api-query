---
title: Conditional Queries
description: Pause queries until their required input is available.
---

Use `{ input: skipToken }` when an input-bearing query has no valid input yet and needs TanStack
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

The same form works for HTTP request input:

```ts
const httpUserOptions = http.users.get.queryOptions({
  input: userId === undefined ? skipToken : { params: { id: userId } },
  staleTime: 30_000,
  select: (user) => user.name,
})
```

The exported `skipToken` is Query Core's exact sentinel. A skipped query uses its operation
prefix as its key, without payload or request identity. Skipping an HTTP query does not encode a
request or invoke the client. The builder preserves caller options and their selected-data types,
and removes `input` before returning the options to TanStack.

Supplied `initialData` remains available. React Query still types skipped hook data as possibly
`undefined`, even with an initial value, because its defined-data overload excludes `skipToken`.

The sentinel applies to input-bearing `queryOptions` and `infiniteOptions` in both adapters, and
to RPC `streamedOptions` and `liveOptions`. Inputless operations run without input, and key and
mutation builders do not accept `skipToken`. TanStack suspense and prefetch-only hooks also reject
skipped options at the type level.

Unary `queryOptions` accepts an input that may be a valid RPC payload or HTTP request, or
`skipToken`. Keep the conditional input inside one builder call so the observer has one consistent
callback type. Concrete inputs and literal `skipToken` keep their precise key types.

The object form also works for accumulated streams and live queries:

```ts
rpcQuery.events.watch.streamedOptions({
  input: skipToken,
  refetchMode: 'append',
  staleTime: 30_000,
})
rpcQuery.events.watch.liveOptions({ input: skipToken, select: (value) => value.length })
```

`refetchMode` configures accumulation. The builder removes it from the returned options even when
the query is skipped. Infinite queries use `{ input: skipToken }` with their required
`initialPageParam` and `getNextPageParam`.

When no caller options are needed, `queryOptions(skipToken)`, `streamedOptions(skipToken)`, and
`liveOptions(skipToken)` remain available as shorthand. A skipped query has no executable query
function, so manual `refetch()` cannot run it. Supply valid input to enable it. If a complete
request is available and you need manual refetch, use `enabled: false` instead.

For HTTP pagination, map each page parameter to the complete request and keep stable filters in
every page. See [Load pages](/effect-api-query/guides/http-queries-and-mutations/#load-pages) for
initial-request identity and cursor progression.

Try this in either [executable example](/effect-api-query/examples/#pause-a-query-until-a-user-is-selected).
The **Choose before fetching** control demonstrates pausing, selecting a user, and reusing fresh
cached data after clearing and reselecting the same user.

The [public RPC consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/public-contract.ts) and
[public HTTP consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/http-contract.ts) check skipped hook inference and rejected uses.
