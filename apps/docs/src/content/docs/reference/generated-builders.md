---
title: RPC Builders
description: Branch and RPC leaf methods for keys, queries, mutations, and streams.
---

Every branch and leaf exposes `key()`, which returns its immutable cache-key prefix.

Each unary RPC leaf also exposes:

| Builder                     | Result                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `queryKey(input?)`          | Payload-specific, data-tagged query key. Payload-bearing RPCs require constructor input.                   |
| `queryOptions(options?)`    | Fresh Query Core options with owned `queryFn`, `queryKey`, and `queryKeyHashFn`.                           |
| `infiniteKey(input?)`       | Data-tagged infinite-query key derived from the initial page's payload.                                    |
| `infiniteOptions(options)`  | Fresh infinite-query options that map each `pageParam` to an RPC payload.                                  |
| `mutationKey()`             | Immutable operation key shared by mutations of this RPC.                                                   |
| `mutationOptions(options?)` | Fresh mutation options with owned `mutationFn` and `mutationKey`. Variables arrive when the mutation runs. |

Payloadless query builders take no input. Payload-bearing builders require an `input` field:

```ts
rpcQuery.health.ping.queryOptions()
rpcQuery.users.get.queryOptions({ input: { id: 1 }, staleTime: 30_000 })
```

Disable a payload-bearing query with `input: skipToken`, retaining its other TanStack options:

```ts
import { skipToken } from 'effect-api-query'

const options =
  userId === undefined
    ? rpcQuery.users.get.queryOptions({ input: skipToken, staleTime: 30_000 })
    : rpcQuery.users.get.queryOptions({ input: { id: userId }, staleTime: 30_000 })
```

`queryOptions`, `streamedOptions`, and `liveOptions` also accept the direct `skipToken` shorthand.
The object form preserves applicable caller options. The builder consumes `input` and, for
accumulated streams, `refetchMode` and `maxChunks`, removing them from the returned options.
Skipped options retain the exact sentinel, operation-level key, and package-owned hash function.

`skipToken` is valid only for payload-bearing query options. It is not accepted by key or mutation
builders, and skipped options are unsuitable for suspense and prefetch-only hooks.

Generated query options also reserve `queryHash`: a caller-supplied hash cannot override generated
cache identity.

## Request-local RPC options

All option builders accept `rpcOptions`. The package forwards it to the ready RPC client on each
execution and removes it from the returned Query Core options, including skipped queries.

| Builders                                             | Request options                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `queryOptions`, `infiniteOptions`, `mutationOptions` | `UnaryRpcOptions`: `headers` and `context`                          |
| `streamedOptions`, `liveOptions`                     | `StreamingRpcOptions`: `headers`, `context`, and `streamBufferSize` |

`headers` accepts Effect's `Headers.Input`; `context` accepts `Context.Context<never>`.
`streamBufferSize` is a number that configures the Effect client's stream buffer. It is independent of
`maxChunks`, which limits the accumulated query cache.

```ts
const options = rpcQuery.users.get.queryOptions({
  input: { id: 1 },
  rpcOptions: { headers: { 'x-request-source': 'user-details' } },
  staleTime: 30_000,
})
```

Request options are fixed for each builder result. Infinite pages, retries, refetches, and repeated
mutations use those same options. Callbacks based on variables or page parameters are unsupported.
Omitting `rpcOptions` leaves the ready client's defaults in effect.

`discard` is unavailable because unary operations need their result. `asQueue` is unavailable
because the package adapts streams itself. Request options do not affect generated keys. If a
header changes the identity of the returned data, represent that identity in the RPC payload or
an application-owned key prefix to keep cache entries separate.

See [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for application-wide configuration.

## Build an infinite query

Map each page parameter to the unary RPC payload. The initial mapped payload also determines the
semantic cache key.

```ts
const userPages = useInfiniteQuery(
  rpcQuery.users.page.infiniteOptions({
    initialPageParam: 0,
    input: (cursor) => ({ cursor, pageSize: 20 }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  }),
)

const initialKey = rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 20 })
```

Payloadless RPCs omit `input`. To disable a payload-bearing infinite query, set its `input` field to
the exact sentinel:

```ts
const options = rpcQuery.users.page.infiniteOptions({
  initialPageParam: 0,
  input: skipToken,
  getNextPageParam: () => undefined,
})
```

The builder forwards applicable Query Core options but owns `queryFn`, `queryKey`, and
`queryKeyHashFn`. Each page uses the same Effect runner and cancellation signal as an ordinary
query.

## Stream values

Each streaming RPC leaf exposes:

| Builder                     | Result                                                                      |
| --------------------------- | --------------------------------------------------------------------------- |
| `streamedKey(input?)`       | Data-tagged key for the accumulated sequence.                               |
| `streamedOptions(options?)` | Fresh Query Core options that append each emitted value to an array.        |
| `liveKey(input?)`           | Data-tagged key for the latest value.                                       |
| `liveOptions(options?)`     | Fresh Query Core options that replace the cached value after each emission. |

Both option builders publish the query as successful after its first value and keep
`fetchStatus: 'fetching'` until the stream ends. An empty accumulated stream resolves to `[]`; an
empty live stream fails with `EffectRpcQueryEmptyStreamError`.

Accumulated streams accept TanStack's `refetchMode` option:

- `reset` clears cached values and returns the query to pending before refetching. This is the
  default.
- `append` adds the new stream's values to the cached sequence.
- `replace` retains the old sequence until the new stream ends, then replaces it atomically.

Set `maxChunks` to a positive safe integer to retain only the newest emitted elements in order:

```ts
const options = utils.events.watch.streamedOptions({
  input: { channel: 'news' },
  maxChunks: 100,
  refetchMode: 'append',
})
```

After each emission, the accumulated array contains at most `maxChunks` elements. On refetch:

- `reset` starts an empty accumulation, even when `initialData` was supplied.
- `append` trims the combined cached and new history.
- `replace` builds a bounded replacement and publishes it when the stream completes.

Initial fetches and append refetches trim existing data only when an element arrives. An empty
append refetch preserves existing data; empty reset and replace refetches finish with an empty
array.

The bound limits the number of elements, discarding older history; it does not limit byte size.
Without it, accumulation remains unbounded. Use `liveOptions` when only the latest value matters.

`maxChunks` configures accumulation, not key identity. Builders consume it before returning options,
including skipped options. Invalid bounds throw `EffectRpcQueryConfigError` with code
`InvalidMaxChunks` synchronously, even when `input` is `skipToken`.

Live queries always replace the cached value and therefore expose no `refetchMode`. Cancelling,
unmounting, or superseding either stream closes its iterator and interrupts its Effect resources.

The [public RPC consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/public-contract.ts) checks the builder examples
and hook types. The [streaming tests](https://github.com/ueberBrot/effect-api-query/blob/main/tests/create-rpc-query-utils-streaming.test.ts)
verify accumulation, replacement, bounds, and cancellation.
