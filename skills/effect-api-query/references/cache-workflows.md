# Defaults, filters, writes, and cache owners

## Register native defaults and filters

Create the QueryClient and utilities once for each owner. Register global defaults,
then matching prefixes from broad to specific; TanStack merges them in registration
order, without sorting by specificity. Omit an option to inherit it. Explicit
`initialData: undefined` overrides an inherited seed, and `staleTime: 0` overrides
inherited freshness. Reuse endpoint-aware callbacks through typed policies; keep
selection and input at each builder call.

```ts
import { QueryClient } from '@tanstack/query-core'
import { Effect, Schema } from 'effect'
import { createRpcQueryUtils, viewPrefix } from 'effect-api-query'
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

Here `everyLocale` matches the encoded string ID across locales. The concrete key
materializes `locale: 'en'` and addresses only that full input. Native partial
filters must follow the actual canonical encoding, including any custom projection.
HTTP filters retain `params`, `query`, `headers`, and `payload` labels and default
lowercase header names. An opaque scalar encoder cannot expose omitted fields to
partial matching; use a broad prefix or an exact generated key.

Root, branch, leaf, and `viewPrefix(leaf, view)` prefixes support native
`invalidateQueries`, `cancelQueries`, and other filters. Exact stream keys include
policy; a view prefix matches all its inputs and stream policies. `viewPrefix`
accepts only supported query views and returns a frozen ordinary tuple, without
a DataTag. Only concrete generated query keys carry data/error tags; broad reads
remain `unknown` until the application establishes their representation. Selection
changes hook, observer, and `queryClient.query` results while the cache keeps full decoded data. Configure hashing
through QueryClient global or prefix `queryKeyHashFn` and keep it stable; builders
reject per-call hashing. Streams reject inconsistent default `queryHash` values
and conflicting cached identity with `UnsupportedQueryHash` during execution.
Retire the old cache before changing its hash policy.
Mutation defaults and keys use the separate native mutation cache.

## Reuse typed query and mutation policies

Use `withQueryPolicy(leaf, view, policy)` to bind common freshness, retry, or
observer callbacks to that leaf's original options builder. Use
`withMutationPolicy(leaf, policy)` for typed mutation callbacks and retry settings.
Create these bound builders once per owner and reuse them at call sites. The
following factory shares a freshness decision and mutation invalidation:

```ts
import { Schema } from 'effect'
import { createRpcQueryUtils, withMutationPolicy, withQueryPolicy } from 'effect-api-query'
import type { QueryPolicy } from 'effect-api-query'
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

Extract a stored policy with `satisfies QueryPolicy<typeof leaf, View>` or
`MutationPolicy<typeof leaf>` to retain contextual callback types. Query callbacks
see that view's cached data and error; mutation callbacks see its data and complete
variables. Input, projection, initial/placeholder data, page mapping, stream
identity, and adapter request controls belong to each bound builder invocation.
QueryClient continues to own hashing; generated functions and keys stay owned.

Mutation policies exclude `onMutate` so local optimistic context retains its
inference. Shared callbacks receive that local result as `unknown`. Call-site
options replace matching defaults, including whole callbacks; callbacks are not
composed. Compose explicitly if both actions are required, and return their
Promise when settlement must wait. Keep originating-owner checks and overlapping
write coordination in the application workflow below. For typed domain failure
classification and shared RPC/HTTP retry decisions, use
[the retry recipe](https://ueberbrot.github.io/effect-api-query/guides/retry-queries/).

## Coordinate overlapping optimistic writes

Keep this workflow in the application and make every participating write follow it:

1. In `onMutate`, capture the originating owner and reserve this write before an
   await. Cancel older reconciliation reads before publishing optimistic state.
2. Snapshot only the affected entities and positions. Preserve unrelated list
   entries, infinite pages, and `pageParams`; allocate temporary IDs per creation.
   Each new deletion captures current fields and positions after an authoritative
   refresh; shared overlap snapshots retain ordering within the owned view.
3. Return the original owner's commit, rollback, and settlement actions in mutation
   context. Check that owner after every await and before any cache side effect.
4. On success, replace only this write's optimistic value and seed exact generated
   detail keys with the response's locale and other identity fields.
5. On failure, remove this write's temporary entry or restore its removed entity
   beside surviving original neighbors. A whole stale-snapshot rollback can erase
   another write. Roll back only a cache revision still owned by the optimistic
   write; preserve later authoritative updates even when structural sharing keeps
   the same data object. Coordinate repeated deletions of the same entity explicitly.
6. Reconcile when the final overlapping write settles. Each new write cancels an
   earlier reconciliation before its optimistic update.

An observer's option update can replace pending callbacks or a not-yet-started
mutation function. Context preserves originating actions; remount consumers at an
owner handoff. Cache rollback cannot undo accepted server work. External writes,
manual replacement, and server ordering need application conflict policy.

## Refresh from application events

Map authenticated, decoded domain events deliberately to native generated filters.
If RPC and HTTP share a domain, name both roots. Capture the original owner in one
scoped consumer; unregister event, Reactivity, and mutation listeners on closure.
Check that owner before queued invalidation and after awaits.

Defer refresh while participating mutations are pending, retain the invalidation
intent, and flush it after settlement. A branch refresh may subsume narrower work.
Effect Reactivity keys need an explicit application mapping; a Query tuple has no
implied Reactivity subscription. Native batching combines invalidations of the same
Reactivity key, without guaranteeing one Query refresh across distinct keys.

An accepted monotonic cursor records invalidation intent, not durable delivery or
successful reads. Replay ordered events with duplicate suppression when supported;
otherwise refresh authoritative reads and reset the sequence deliberately. The
application owns authentication, reconnect, replay storage, epochs, acknowledgements,
and out-of-order delivery.

## Replace an owner in order

Partition results by safe tenant, user, backend, session, and permission-generation
identity in `keyPrefix`; keep credentials out of keys. Capture the retiring owner,
unmount its consumers, mark it inactive, stop new work, cancel queries, and drain
accepted mutations and local streams before releasing ready-client resources.
Only then acquire and mount the replacement. Apply this sequence even when semantic
identity is unchanged. A provider client prop change alone does not replace hook
ownership. Guard late commit, rollback, and settlement callbacks even after drain.

An accepted command may finish remotely during retirement; completed work persists.
Use an explicit application command-cancellation operation to stop future domain
work. Local retirement supplies neither rollback nor remote cancellation acknowledgement.
A hanging request or finalizer can delay handoff. For an operation-ID protocol with
separate start, progress, and cancel calls, use the
[cancellable commands example](https://ueberbrot.github.io/effect-api-query/examples/cancellable-commands/).

For reload persistence, allowlist a validated DTO view, repeat the safe owner tuple
in its envelope, and include schema/key version busters. Restore only matching
identities through freshly generated keys; discard foreign or incompatible data
before writing. Avoid persisting pending optimistic values, arbitrary caches, errors,
mutations, credentials, or class prototypes. Use paired codecs for rich values.

Explicit disposal should expose storage failures while completing resource cleanup.
Lifecycle callbacks such as pagehide or HMR must handle a rejected disposal Promise
so it does not become an unhandled rejection. Preserve the chosen reload-persistence
policy and ordered cleanup.

Sources: [defaults and policies](https://ueberbrot.github.io/effect-api-query/guides/query-defaults/),
[cache keys and filters](https://ueberbrot.github.io/effect-api-query/guides/cache-filters/),
[optimistic writes](https://ueberbrot.github.io/effect-api-query/guides/optimistic-writes/),
[owner replacement](https://ueberbrot.github.io/effect-api-query/guides/switch-cache-owners/),
[event refresh](https://ueberbrot.github.io/effect-api-query/guides/refresh-from-events/).
