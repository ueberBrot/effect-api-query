# Defaults, filters, writes, and cache owners

## Register native defaults and filters

Create the QueryClient and utilities once per owner. Register global defaults,
then matching prefixes from broad to specific. TanStack merges defaults in
registration order without sorting by specificity. To inherit an option, omit it.
Explicit `initialData: undefined` overrides an inherited seed. `staleTime: 0`
overrides inherited freshness. Reuse endpoint-aware callbacks through typed
policies. Keep selection and input at each builder call.

```ts
import { QueryClient } from '@tanstack/query-core'
import { createRpcQueryUtils, viewPrefix } from '@ueberbrot/effect-api-query'
import { Effect, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'

export const users = RpcGroup.make(
  Rpc.make('users.read', {
    payload: {
      id: Schema.FiniteFromString,
      locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))),
    },
    success: Schema.Struct({ id: Schema.Finite, name: Schema.String, locale: Schema.String }),
  }),
)

export function userCache(client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof users>>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rpc = createRpcQueryUtils(users, { client, keyPrefix: ['users-app'] })
  queryClient.setQueryDefaults(rpc.key(), { staleTime: 30_000 })
  queryClient.setQueryDefaults(rpc.users.key(), { gcTime: 600_000 })
  const queryPrefix = viewPrefix(rpc.users.read, 'query')
  queryClient.setQueryDefaults(queryPrefix, { staleTime: 60_000 })
  return {
    queryClient,
    selected: rpc.users.read.queryOptions({
      input: { id: 1 },
      initialData: undefined,
      select: (user) => user.name,
    }),
    exact: { queryKey: rpc.users.read.queryKey({ id: 1 }), exact: true as const },
    everyLocale: { queryKey: [...queryPrefix, { id: '1' }] as const },
  }
}
```

`everyLocale` matches the encoded string ID across locales. The concrete key
materializes `locale: 'en'` and addresses only that full input. Native partial
filters must follow the actual canonical encoding, including custom projections.
HTTP filters retain `params`, `query`, `headers`, and `payload` labels. With default
encoding, header names are lowercase. An opaque scalar encoder cannot expose
omitted fields to partial matching. In that case, use a broad prefix or an exact
generated key.

Root, branch, leaf, and `viewPrefix(leaf, view)` prefixes support native
`invalidateQueries`, `cancelQueries`, and other filters. Exact stream keys include
policy. A view prefix matches all inputs and stream policies for that view.
`viewPrefix` accepts only supported query views and returns a frozen ordinary
tuple without a DataTag. Only concrete generated query keys carry data and error
tags. Broad reads remain `unknown` until the application establishes their
representation.

Selection changes hook, observer, and `queryClient.query` results. The cache
retains full decoded data. Configure hashing through QueryClient global or prefix
`queryKeyHashFn` and keep it stable. Builders reject per-call hashing. During
execution, streams reject inconsistent default `queryHash` values and conflicting
cached identity with `UnsupportedQueryHash`. Before changing the hash policy,
retire the old cache. Mutation defaults and keys use the separate native mutation
cache.

## Reuse typed query and mutation policies

To bind common freshness, retry, or observer callbacks to a leaf's original
options builder, use `withQueryPolicy(leaf, view, policy)`.
For typed mutation callbacks and retry settings, use
`withMutationPolicy(leaf, policy)`. Create these bound builders once per owner.
Reuse them at call sites. The following factory shares a freshness decision and
mutation invalidation:

```ts
import {
  createRpcQueryUtils,
  withMutationPolicy,
  withQueryPolicy,
} from '@ueberbrot/effect-api-query'
import type { QueryPolicy } from '@ueberbrot/effect-api-query'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'

export const directory = RpcGroup.make(
  Rpc.make('users.get', {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  }),
  Rpc.make('users.rename', {
    payload: { id: Schema.Int, name: Schema.String },
    success: Schema.Void,
  }),
)

export function userPolicies(client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof directory>>) {
  const rpc = createRpcQueryUtils(directory, { client, keyPrefix: ['directory-app'] })
  const policy = {
    staleTime: (query) => (query.state.data === undefined ? 0 : 60_000),
    retry: false,
  } satisfies QueryPolicy<typeof rpc.users.get>
  const read = withQueryPolicy(rpc.users.get, 'query', policy)
  const rename = withMutationPolicy(rpc.users.rename, {
    onSuccess: (_data, _variables, _result, context) =>
      context.client.invalidateQueries({ queryKey: rpc.users.key() }),
  })
  return {
    read,
    rename,
    selected: read({ input: { id: 1 }, select: (user) => user.name }),
    refreshed: read({ input: { id: 2 }, staleTime: 0 }),
  }
}
```

To retain contextual callback types in a stored policy, use
`satisfies QueryPolicy<typeof leaf, View>` or `MutationPolicy<typeof leaf>`.
Query callbacks receive the view's cached data and error. Mutation callbacks
receive its data and complete variables. Input, projection, initial and placeholder
data, page mapping, stream identity, and adapter request controls stay local to
each bound builder invocation. QueryClient still owns hashing. The library still
owns generated functions and keys.

Mutation policies exclude `onMutate` to preserve inference for local optimistic
context. Shared callbacks receive that local result as `unknown`. Call-site options
replace matching defaults, including whole callbacks. The helpers do not compose
callbacks. If both actions are required, compose them explicitly. If settlement
must wait, return their Promise.

Keep checks of the originating owner and coordination of overlapping writes in
the application workflow below. For typed domain failure classification and
shared RPC/HTTP retry decisions, use
[the retry recipe](https://ueberbrot.github.io/effect-api-query/guides/retry-queries/).

## Coordinate overlapping optimistic writes

The application owns this workflow. Make every participating write follow these
steps:

1. In `onMutate`, capture the originating owner and reserve this write before any
   await. Before publishing optimistic state, cancel older reconciliation reads.
2. Snapshot only the affected entities and positions. Preserve unrelated list
   entries, infinite pages, and `pageParams`. Allocate temporary IDs per creation.
   After an authoritative refresh, each new deletion captures current fields and
   positions. Shared overlap snapshots retain ordering within the owned view.
3. Return the original owner's commit, rollback, and settlement actions in mutation
   context. After every await and before any cache side effect, check that owner.
4. On success, replace only this write's optimistic value. Seed exact generated
   detail keys with the response's locale and other identity fields.
5. On failure, remove this write's temporary entry or restore its removed entity
   beside surviving original neighbors. Rolling back a whole stale snapshot can
   erase another write. Roll back only a cache revision that the optimistic write
   still owns. Preserve later authoritative updates even when structural sharing
   keeps the same data object. Explicitly coordinate repeated deletions of the
   same entity.
6. When the final overlapping write settles, reconcile. Each new write cancels an
   earlier reconciliation before publishing its optimistic update.

An observer's option update can replace pending callbacks or a mutation function
that has not started. Context preserves originating actions. At an owner handoff,
remount consumers. Cache rollback cannot undo accepted server work. External writes,
manual replacement, and server ordering require an application conflict policy.

## Refresh from application events

Explicitly map authenticated, decoded domain events to native generated filters.
If RPC and HTTP share a domain, name both roots. Capture the original owner in one
scoped consumer. On closure, unregister event, Reactivity, and mutation listeners.
Before queued invalidation and after awaits, check that owner.

While participating mutations are pending, defer refresh and retain the invalidation
intent. After settlement, flush that intent. A branch refresh can cover narrower
work. Effect Reactivity keys need an explicit application mapping. A Query tuple
does not imply a Reactivity subscription. Native batching combines invalidations
of the same Reactivity key. It does not guarantee one Query refresh across
distinct keys.

An accepted monotonic cursor records invalidation intent. It does not establish
durable delivery or successful reads. If supported, replay ordered events with
duplicate suppression. Otherwise, refresh authoritative reads and explicitly reset
the sequence. The application owns authentication, reconnect, replay storage,
epochs, acknowledgments, and out-of-order delivery.

## Replace an owner in order

Partition results by safe tenant, user, backend, session, and permission-generation
identity in `keyPrefix`. Keep credentials out of keys. Capture the retiring owner,
then unmount its consumers. Mark it inactive and stop new work. Cancel queries and
drain accepted mutations and local streams before releasing ready-client resources.
Only then acquire and mount the replacement.

Apply this sequence even when semantic identity stays the same. Changing a provider
client prop alone does not replace hook ownership. Guard late commit, rollback,
and settlement callbacks even after draining work.

An accepted command can finish remotely during retirement. Completed work persists.
To stop future domain work, use an explicit application command-cancellation operation.
Local retirement supplies neither rollback nor acknowledgment of remote cancellation.
A hanging request or finalizer can delay handoff. For an operation-ID protocol
with separate start, progress, and cancel calls, use the
[cancellable commands example](https://ueberbrot.github.io/effect-api-query/examples/cancellable-commands/).

For reload persistence, allowlist a validated DTO view. Repeat the safe owner tuple
in its envelope and include version busters for schemas and keys. Restore only
matching identities through freshly generated keys. Before writing, discard foreign
or incompatible data. Avoid persisting pending optimistic values, arbitrary caches,
errors, mutations, credentials, or class prototypes. For rich values, use paired
codecs.

During explicit disposal, expose storage failures while completing resource cleanup.
Lifecycle callbacks such as pagehide or HMR must handle a rejected disposal Promise.
Otherwise, it becomes an unhandled rejection. Preserve the chosen reload-persistence
policy and cleanup order.

Sources: [defaults and policies](https://ueberbrot.github.io/effect-api-query/guides/query-defaults/),
[cache keys and filters](https://ueberbrot.github.io/effect-api-query/guides/cache-filters/),
[optimistic writes](https://ueberbrot.github.io/effect-api-query/guides/optimistic-writes/),
[owner replacement](https://ueberbrot.github.io/effect-api-query/guides/switch-cache-owners/),
[event refresh](https://ueberbrot.github.io/effect-api-query/guides/refresh-from-events/).
