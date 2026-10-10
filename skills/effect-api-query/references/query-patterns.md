# Conditional reads, pages, and streams

## Conditional reads with React Query

Use `input: skipToken` when required input is unavailable. `enabled: false` still
constructs a concrete key and therefore needs valid input. Use `enabled: false`
when you have valid input and intend to execute through manual refetch.

This example exports a hook factory for an application-owned ready RPC client.
Call the factory during application setup. Use the returned hook in components
under the application's `QueryClientProvider`.

```ts
import { useQuery } from '@tanstack/react-query'
import { Schema } from 'effect'
import { createRpcQueryUtils, skipToken } from 'effect-api-query'
import { Rpc, RpcGroup, type RpcClient } from 'effect/rpc'

export const users = RpcGroup.make(
  Rpc.make('users.get', {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  }),
)

export function makeUseUser(client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof users>>) {
  const rpc = createRpcQueryUtils(users, { client, keyPrefix: ['users-app'] })
  return function useUser(id: number | undefined) {
    return useQuery(
      rpc.users.get.queryOptions({
        input: id === undefined ? skipToken : { id },
        staleTime: 30_000,
      }),
    )
  }
}
```

HTTP uses the same conditional pattern with its decoded request shape. Unary,
streamed, and live options also accept direct `skipToken`; their object form
preserves caller options. Inputless operations, key builders, and mutations do
not accept it. Skipped options cannot execute through manual refetch and are
unsuitable for suspense or prefetch-only hooks.

## Infinite queries

Map each page parameter to a complete request. The initial mapped request sets
cache identity, so include stable filters in that request and every page. Keep
the mapper deterministic: it runs during key construction and again on execution.

```ts
import { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcGroup, type RpcClient } from 'effect/rpc'

export const catalog = RpcGroup.make(
  Rpc.make('items.page', {
    payload: { cursor: Schema.Int, category: Schema.String },
    success: Schema.Struct({
      items: Schema.Array(Schema.String),
      nextCursor: Schema.NullOr(Schema.Int),
    }),
  }),
)

export async function loadPages(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof catalog>>,
  queryClient: QueryClient,
) {
  const rpc = createRpcQueryUtils(catalog, { client, keyPrefix: ['catalog-app'] })
  return queryClient.infiniteQuery(
    rpc.items.page.infiniteOptions({
      initialPageParam: 0,
      input: (cursor) => ({ cursor, category: 'books' }),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
  )
}
```

Pass the same options to `useInfiniteQuery` for interactive pagination. The HTTP
input mapper returns decoded request parts, for example
`{ query: { cursor, category: 'books' } }`. Use `infiniteKey` with the complete
initial input for cache access. Infinite data and ordinary query data have
different keys and shapes. Pause an input-bearing infinite query with
`input: skipToken` inside the options object, not a mapper returning the sentinel.

## RPC streams

```ts
import { Schema } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcGroup, type RpcClient } from 'effect/rpc'

export const events = RpcGroup.make(
  Rpc.make('events.watch', {
    payload: { channel: Schema.String },
    success: Schema.String,
    stream: true,
  }),
)

export function eventOptions(client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof events>>) {
  const rpc = createRpcQueryUtils(events, { client, keyPrefix: ['events-app'] })
  const input = { channel: 'news' }
  const policy = { maxChunks: 100, refetchMode: 'append' as const }
  return {
    history: rpc.events.watch.streamedOptions({
      input,
      ...policy,
    }),
    historyKey: rpc.events.watch.streamedKey(input, policy),
    latest: rpc.events.watch.liveOptions({ input }),
  }
}
```

Use either result with `useQuery` or a query observer. They are distinct cache
entries and start independent executions when both are observed.

Accumulated queries retain emitted elements in order. `maxChunks` is a positive
safe integer limiting element count, not bytes; omission leaves history unbounded.
Both `maxChunks` and `refetchMode` contribute to normalized cache identity.
Omitted policy and explicit unlimited/reset policy share an identity; different
bounds or refetch modes use different entries. Use `streamedKey(input, policy)`
or the matching options' `queryKey`. Inputless operations take the policy first.
HTTP accumulated views additionally include SSE decoder policy; HTTP live views
include decoder policy too.

- `reset` (default) clears data and returns to pending on refetch.
- `append` adds new emissions to cached history.
- `replace` retains cached history until the refetch stream completes, then
  replaces it. For this policy, use a stream that completes.

Live queries cache only the latest value and accept neither history option.
With no cached data, an empty accumulated stream resolves to `[]`. An empty
append refetch preserves existing history; empty reset and replace refetches
finish with `[]`. Empty live completion raises `EffectRpcQueryEmptyStreamError`.
Live queries normalize each emitted `undefined` to `null`, including an emission
after a defined value. Live keys, selectors, and initial data use that normalized
type. Accumulated chunks retain their original values, including `undefined`.

On an initial fetch, both views become successful after the first emission. They
keep fetching until completion. Canceling closes the iterator and interrupts its
Effect resources. Native cancellation can settle before local finalizers finish.
An awaited QueryClient call waits for stream completion; hooks and observers see
intermediate values. For SSR, read [hydration and SSR](hydration-and-ssr.md) and use
`fetchStreamSnapshot` to capture and drain an open query.

Bounds take effect after a new emission. An oversized seed remains until then.
Each publication uses a new array and leaves earlier histories unchanged; arrays
are not runtime-frozen, so treat cache values as immutable. A bound limits element
count, not retained object size or bytes.

Each consumed value contributes to cache writes. Native structural sharing does
not suppress those writes or promise a renderer's update count. Choose a live
query for complete current-state emissions and bounded history for recent events;
the latest delta alone cannot reconstruct state. Construction, compiler, and
bundle measurements describe the measured fixtures, not universal time, memory,
or application-bundle budgets. No batching or publication-suppression API is
provided.

Sources: [builders](https://ueberbrot.github.io/effect-api-query/reference/generated-builders/),
[stream history](https://ueberbrot.github.io/effect-api-query/guides/choose-stream-history/).
