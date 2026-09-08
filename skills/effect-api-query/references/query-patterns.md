# Conditional reads, pages, streams, and SSR

## Conditional reads with React Query

Use `input: skipToken` when required input is unavailable. `enabled: false` still
constructs a concrete key and therefore needs valid input. Use `enabled: false`
when you have valid input and intend to execute through manual refetch.

This example exports a hook factory for an application-owned ready RPC client.
Call the factory during application setup and the returned hook in components
under the application's `QueryClientProvider`.

```ts
import { useQuery } from '@tanstack/react-query'
import { Schema } from 'effect'
import { createRpcQueryUtils, skipToken } from 'effect-api-query'
import { Rpc, RpcGroup, type RpcClient } from 'effect/unstable/rpc'

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
import { Rpc, RpcGroup, type RpcClient } from 'effect/unstable/rpc'

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
import { Rpc, RpcGroup, type RpcClient } from 'effect/unstable/rpc'

export const events = RpcGroup.make(
  Rpc.make('events.watch', {
    payload: { channel: Schema.String },
    success: Schema.String,
    stream: true,
  }),
)

export function eventOptions(client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof events>>) {
  const rpc = createRpcQueryUtils(events, { client, keyPrefix: ['events-app'] })
  return {
    history: rpc.events.watch.streamedOptions({
      input: { channel: 'news' },
      maxChunks: 100,
      refetchMode: 'append',
    }),
    latest: rpc.events.watch.liveOptions({ input: { channel: 'news' } }),
  }
}
```

Use either result with `useQuery` or a query observer. They are distinct cache
entries and start independent executions when both are observed.

Accumulated queries retain emitted elements in order. `maxChunks` is a positive
safe integer limiting element count, not bytes; omission leaves history unbounded.
Choose a consistent policy for each cache entry: `maxChunks` and `refetchMode`
are not part of its identity.

- `reset` (default) clears data and returns to pending on refetch.
- `append` adds new emissions to cached history.
- `replace` retains cached history until the refetch stream completes, then
  replaces it. Use a completing stream when choosing this publication policy.

Live queries cache only the latest value and accept neither history option.
With no cached data, an empty accumulated stream resolves to `[]`. An empty
append refetch preserves existing history; empty reset and replace refetches
finish with `[]`. Empty live completion raises `EffectRpcQueryEmptyStreamError`.
Emitted chunks are retained as supplied, unlike buffered query `undefined`
normalization.

On an initial fetch, both views become successful after the first emission, but
keep fetching until completion. Canceling closes the iterator and interrupts its
Effect resources. An awaited QueryClient call waits for stream completion; use cache
observation to consume intermediate values.

## Server rendering and hydration

Create a fresh QueryClient, client, and runtime for each server request.
Share the generated options between loaders and components through
router context. Keep key prefixes and inputs equivalent between server and
browser, while preserving separate resource ownership. Choose `staleTime` to
avoid an immediate duplicate read during hydration.

Keep successful query data compatible with the application's serializer. The
package does not serialize Schema classes, dates, binary values, or error Causes.
TanStack's default dehydration policy omits failed queries so the browser can
refetch them; preserve that policy unless the application defines its own safe
error serialization contract.

For an open RPC stream, observe the first successful cache snapshot, cancel the
query, and then dehydrate. Awaiting stream completion can stall SSR indefinitely.
Register cleanup for request completion and abort; cancel queries before runtime
disposal. Keep browser resources alive for the application's lifetime.

Sources: [builders](https://ueberbrot.github.io/effect-api-query/reference/generated-builders/),
[TanStack Start integration](https://ueberbrot.github.io/effect-api-query/guides/tanstack-start/).
