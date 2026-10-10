# Capture, hydrate, and dispose request data

## Capture an open stream

Use a fresh request-owned QueryClient and keep its ready clients, runner, and Scope
alive until every capture and preparation settles. `queryClient.query` waits for
stream completion. Use `fetchStreamSnapshot` for the first new cache publication or
normal completion; it cancels that exact query and awaits local iterator cleanup.

```ts
import { dehydrate } from '@tanstack/query-core'
import type { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createRpcQueryUtils, fetchStreamSnapshot } from 'effect-api-query'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'

export const updates = RpcGroup.make(
  Rpc.make('updates.watch', {
    payload: { channel: Schema.String },
    success: Schema.String,
    stream: true,
  }),
)

export async function captureUpdates(
  queryClient: QueryClient,
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof updates>>,
  signal: AbortSignal,
) {
  const rpc = createRpcQueryUtils(updates, { client, keyPrefix: ['updates-app'] })
  const options = rpc.updates.watch.streamedOptions({
    input: { channel: 'news' },
    maxChunks: 20,
    retry: false,
  })
  await fetchStreamSnapshot(queryClient, options, { signal, timeoutMs: 5_000 })
  return dehydrate(queryClient, { shouldDehydrateMutation: () => false })
}
```

The same helper accepts RPC or HTTP accumulated/live options. Default `fresh` mode
starts a new attempt even with initial or cached success. `append` retains existing
history. A `replace` refetch of previously fetched data publishes only at completion,
so an indefinite replacement needs completion or timeout. Explicit `mode: 'cached'`
reuses successful data without starting or cancelling work, and falls back to fresh
when no successful entry exists. Native `select` and QueryClient defaults apply.

Reserve the exact key exclusively during fresh capture: it must be idle and
unobserved. Avoid same-key writes, observers, and concurrent fetches until settlement;
an external manual publication can otherwise look like a stream emission. Other
keys keep running. Hash through QueryClient defaults; per-call `queryHash` and
`queryKeyHashFn` are rejected.

Abort and timeout stop the data wait, then cleanup is awaited before resolution or
rejection. `timeoutMs` does not bound finalization. Local settlement does not await a
remote cancellation acknowledgement. Dispose client resources after helper settlement.

## Choose a consistent cache representation

Server and browser need equivalent contracts, inputs, safe prefixes, and hashing.
Use independent QueryClients, clients, runners, and Scopes. Choose `staleTime` to
control the first browser refetch; a new browser stream reconnects independently.

Use JSON-safe success DTOs in both caches, or encode decoded domain values at the
snapshot boundary and decode them during hydration. `select` changes observer data,
not the cache. `structuredClone` does not restore class prototypes or supply JSON
codecs for bigint and bytes. This synchronous paired codec keeps rich values through
hydration and later contract refetch:

```ts
import { defaultShouldDehydrateQuery, dehydrate, hydrate } from '@tanstack/query-core'
import type { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'

export class Profile extends Schema.Class<Profile>('Profile')({
  name: Schema.String,
  credits: Schema.BigIntFromString,
  avatar: Schema.Uint8ArrayFromBase64,
}) {
  summary() {
    return `${this.name}: ${this.credits} credits`
  }
}

export const snapshotProfile = (queryClient: QueryClient): string =>
  JSON.stringify(
    dehydrate(queryClient, {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query) =>
        defaultShouldDehydrateQuery(query) && query.queryKey[0] === 'profile',
      serializeData: Schema.encodeUnknownSync(Profile),
    }),
  )

export const hydrateProfile = (queryClient: QueryClient, json: string): void =>
  hydrate(queryClient, JSON.parse(json), {
    defaultOptions: { deserializeData: Schema.decodeUnknownSync(Profile) },
  })
```

Reserve this recipe's prefix for unary `Profile` data and declare `Profile` as the
operation success on both sides. The enclosing snapshot must come from the matching
application encoder. Synchronous callbacks require service-free synchronous codecs.

For effectful or serviceful codecs, run application-owned preparation before native
dehydration transport or hydration. Await all selected encodings before publishing
one snapshot. Decode all selected entries before one native `hydrate` call, so one
failed decode leaves the destination untouched. Never store preparation Effects or
Promises as query data. Supply codec services through the owning runtime.

Choose codecs for the complete view:

| View                        | Preserve                                                                      |
| --------------------------- | ----------------------------------------------------------------------------- |
| Infinite data               | Every `pages` value and `pageParams` representation                           |
| Accumulated stream          | Ordered decoded values, including distinct `undefined` and `null`             |
| Live stream                 | Latest decoded value, with top-level `undefined` already normalized to `null` |
| HTTP decoded header wrapper | Body and decoded headers, reconstructing the wrapper                          |
| HTTP metadata               | Decoded data/wrapper, status, and approved raw string headers                 |

JSON turns undefined array elements into null; use a tagged codec when accumulated
history distinguishes them. A header wrapper with an undefined body remains a
wrapper, so preserve that body separately. Encode all declared success alternatives
and rich page parameters. The package supplies no codec registry or serializer.

Retain `defaultShouldDehydrateQuery` to omit failed queries. Custom error transfer
must separately encode `state.error` and `state.fetchFailureReason`; data codecs do
not sanitize Causes, headers, or those fields. A safe error DTO does not automatically
reconstruct package error classes. Apply application disclosure rules before transport.

## Drain request work before disposal

Track abortable preparation and snapshot captures in the request owner. On request
completion or abort, stop accepting work, abort pending preparation/captures, cancel
queries, and await their settlement and local finalizers before closing clients or
runtimes. Cancelling QueryClient work alone does not drain codec preparation or
acknowledge finalization. Clear the request's private cache as part of its lifecycle.
The browser acquires independent resources after hydration.

Sources: [stream snapshots](https://ueberbrot.github.io/effect-api-query/guides/stream-snapshots/),
[unary hydration](https://ueberbrot.github.io/effect-api-query/guides/hydrate-unary-data/),
[query-view codecs](https://ueberbrot.github.io/effect-api-query/guides/hydrate-query-views/).
