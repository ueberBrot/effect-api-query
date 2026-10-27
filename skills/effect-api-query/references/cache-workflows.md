# Defaults, filters, writes, and cache owners

## Register native defaults and filters

Create the QueryClient and utilities once per owner. Register global defaults, then matching prefixes from broad to specific. TanStack merges defaults in registration order without sorting by specificity. To inherit an option, omit it. Explicit `initialData: undefined` overrides an inherited seed. `staleTime: 0` overrides inherited freshness. Reuse endpoint-aware callbacks through typed policies. Keep selection and input at each builder call.

```ts
import { QueryClient } from "@tanstack/query-core";
import {
  createQueryFilter,
  createRpcQueryUtils,
  viewPrefix,
} from "@ueberbrot/effect-api-query";
import { Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

export const users = RpcGroup.make(
  Rpc.make("users.read", {
    payload: {
      id: Schema.FiniteFromString,
      locale: Schema.String.pipe(
        Schema.withConstructorDefault(Effect.succeed("en"))
      ),
    },
    success: Schema.Struct({
      id: Schema.Finite,
      name: Schema.String,
      locale: Schema.String,
    }),
  })
);

export function userCache(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof users>>
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rpc = createRpcQueryUtils(users, { client, keyPrefix: ["users-app"] });
  queryClient.setQueryDefaults(rpc.key(), { staleTime: 30_000 });
  queryClient.setQueryDefaults(rpc.users.key(), { gcTime: 600_000 });
  const queryPrefix = viewPrefix(rpc.users.read, "query");
  queryClient.setQueryDefaults(queryPrefix, { staleTime: 60_000 });
  return {
    queryClient,
    selected: rpc.users.read.queryOptions({
      input: { id: 1 },
      initialData: undefined,
      select: (user) => user.name,
    }),
    exact: {
      queryKey: rpc.users.read.queryKey({ id: 1 }),
      exact: true as const,
    },
    everyLocale: createQueryFilter(rpc.users.read, "query", (id: number) => ({
      id: String(id),
    }))(1),
  };
}
```

`createQueryFilter` binds a supported leaf view and an explicit typed projection into the canonical key shape. Its projection defaults to the leaf input type; an explicitly annotated parameter can select a scalar or partial application input. It must return strict JSON. It skips full constructors and their defaults. Filter values are copied and frozen; invalid projections fail during preparation. Omit the projection for native conditions across the whole view.

`everyLocale` matches the encoded string ID across locales. The concrete key materializes `locale: 'en'` and addresses only that full input. Native partial filters must follow the actual canonical encoding, including custom projections. HTTP filters retain `params`, `query`, `headers`, and `payload` labels. With default encoding, header names are lowercase. An opaque scalar encoder cannot expose omitted fields to partial matching. In that case, use a broad prefix or an exact generated key.

Root, branch, leaf, and `viewPrefix(leaf, view)` prefixes support native `invalidateQueries`, `cancelQueries`, and other filters. Exact stream keys include policy. A view prefix matches all inputs and stream policies for that view. `viewPrefix` accepts only supported query views and returns a frozen ordinary tuple without a DataTag. Only concrete generated query keys carry data and error tags. Broad reads remain `unknown` until the application establishes their representation.

Selection changes hook, observer, and `queryClient.query` results. The cache retains full decoded data. Configure hashing through QueryClient global or prefix `queryKeyHashFn` and keep it stable. Builders reject per-call hashing. During execution, streams reject inconsistent default `queryHash` values and conflicting cached identity with `UnsupportedQueryHash`. Before changing the hash policy, retire the old cache. Mutation defaults and keys use the separate native mutation cache.

Use `createBranchQueryFilter(branch, view)` when only one view across a namespace should refresh. Its returned native filter combines supported descendant views with a caller predicate. Missing views match nothing, and bulk results remain heterogeneous. Leave `exact` omitted to match descendants. Pass the returned filter to native QueryClient methods when view isolation matters.

For a typed error union, `findDeclaredError(error, tag)` returns an Effect Option for exactly one tagged failure. Only tags in the typed union are accepted. Composite Causes, defects, interruptions, and non-wrapper errors return None. Preserve the original wrapper for diagnostics and retry decisions. Tag matching does not validate unknown values or establish that a failure is retryable.

## Configure shared behavior

Use `configureUtils(treeOrLeaf, configuration)` once per cache owner. Configure a query view with `{ policy, interceptors }`; configure a mutation with `{ policy, interceptors, callbacks }`. Use `scoped` to select named children of a tree or branch. The returned utilities are frozen and retain generated identity and prepared-input ownership. Keep the supplied tree for any consumers that need its original behavior.

The following factory configures typed freshness and mutation invalidation:

```ts
import {
  configureUtils,
  createRpcQueryUtils,
} from "@ueberbrot/effect-api-query";
import type { QueryPolicy } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

export const directory = RpcGroup.make(
  Rpc.make("users.get", {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  }),
  Rpc.make("users.rename", {
    payload: { id: Schema.Int, name: Schema.String },
    success: Schema.Void,
  })
);

export function userPolicies(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof directory>>
) {
  const rpc = createRpcQueryUtils(directory, {
    client,
    keyPrefix: ["directory-app"],
  });
  const policy = {
    staleTime: (query) => (query.state.data === undefined ? 0 : 60_000),
    retry: false,
  } satisfies QueryPolicy<typeof rpc.users.get>;
  const read = configureUtils(rpc.users.get, { query: { policy } });
  const rename = configureUtils(rpc.users.rename, {
    mutation: {
      callbacks: "compose",
      policy: {
        onSuccess: (_data, _variables, _result, context) =>
          context.client.invalidateQueries({ queryKey: rpc.users.key() }),
      },
    },
  });
  return {
    read,
    rename,
    selected: read.queryOptions({
      input: { id: 1 },
      select: (user) => user.name,
    }),
    refreshed: read.queryOptions({ input: { id: 2 }, staleTime: 0 }),
  };
}
```

Use the same `directory` contract to require an application authorization check before a write:

```ts
export function authorizedRename(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof directory>>,
  authorize: (id: number) => Promise<void>
) {
  const rpc = createRpcQueryUtils(directory, {
    client,
    keyPrefix: ["directory-app"],
  });
  return configureUtils(rpc.users.rename, {
    mutation: {
      interceptors: [
        async ({ input, next }) => {
          await authorize(input.id);
          return await next();
        },
      ],
    },
  });
}
```

Leaf callbacks receive the view's typed data and errors, or the mutation's typed result and variables. Stored policy objects can use `satisfies QueryPolicy<typeof leaf, View>` or `MutationPolicy<typeof leaf>`. Shared tree and branch policy callbacks receive unknown data, errors, and variables. Configure a leaf when a callback needs its concrete contract.

Apply policies from broad to specific: QueryClient defaults, configured tree, branch, leaf, then call-site options. Preserve input, selection, initial and placeholder data, page mapping, adapter controls, and optimistic context at the call site. Stream configuration may supply `streamed.policy.maxChunks` and publication controls; matching key builders inherit the same policy.

More specific and call-site mutation callbacks replace corresponding broader callbacks by default. Set `mutation.callbacks: "compose"` when shared and more specific callbacks must both run. Composition awaits shared before specific for `onSuccess`, `onError`, and `onSettled`. A rejection stops that pair and follows native mutation handling. Keep `onMutate` local; shared policy callbacks receive its result as unknown.

Composition applies to the callbacks added by that scope. Broader composed callbacks remain active when narrower scopes use replacement.

An explicit JavaScript `undefined` callback override clears that callback's composed defaults. Preserve native TypeScript callback types.

Interceptors run from tree to branch to leaf, with the first entry outermost. Each native attempt, including retries, permits at most one `next` call per interceptor. Infinite-query continuations return one page. Mutations also receive input; native context is undefined for direct calls without an observer. Honor the query signal in surrounding application work. Skipped queries stay disabled. Local callbacks cannot replace execution interception.

Repeated configuration preserves scope order. Within one scope, later policies replace earlier values and earlier interceptors remain outermost.

Within one mutation scope, later callbacks replace earlier callbacks and the latest supplied callback mode applies to the merged policy. Configured trees remain assignable to their original utility types.

Check reusable configurations with `satisfies UtilsConfiguration<typeof tree>`. A type annotation widens optional settings and can prevent builders from inferring that stream retention has already been supplied.

After configuration, type-check a representative call with selection, conditional input, or local optimistic context. Keep checks of the originating owner and coordination of overlapping writes in the application workflow below. For typed failure classification and shared RPC/HTTP retry decisions, use [the retry recipe](https://ueberbrot.github.io/effect-api-query/guides/retry-queries/).

## Coordinate overlapping optimistic writes

The application owns this workflow. Make every participating write follow these steps:

1. In `onMutate`, capture the originating owner and reserve this write before any await. Before publishing optimistic state, cancel older reconciliation reads.
2. Snapshot only the affected entities and positions. Preserve unrelated list entries, infinite pages, and `pageParams`. Allocate temporary IDs per creation. After an authoritative refresh, each new deletion captures current fields and positions. Shared overlap snapshots retain ordering within the owned view.
3. Return the original owner's commit, rollback, and settlement actions in mutation context. After every await and before any cache side effect, check that owner.
4. On success, replace only this write's optimistic value. Seed exact generated detail keys with the response's locale and other identity fields.
5. On failure, remove this write's temporary entry or restore its removed entity beside surviving original neighbors. Rolling back a whole stale snapshot can erase another write. Roll back only a cache revision that the optimistic write still owns. Preserve later authoritative updates even when structural sharing keeps the same data object. Explicitly coordinate repeated deletions of the same entity.
6. When the final overlapping write settles, reconcile. Each new write cancels an earlier reconciliation before publishing its optimistic update.

An observer's option update can replace pending callbacks or a mutation function that has not started. Context preserves originating actions. At an owner handoff, remount consumers. Cache rollback cannot undo accepted server work. External writes, manual replacement, and server ordering require an application conflict policy.

## Refresh from application events

Explicitly map authenticated, decoded domain events to native generated filters. If RPC and HTTP share a domain, name both roots. Capture the original owner in one scoped consumer. On closure, unregister event, Reactivity, and mutation listeners. Before queued invalidation and after awaits, check that owner.

While participating mutations are pending, defer refresh and retain the invalidation intent. After settlement, flush that intent. A branch refresh can cover narrower work. Effect Reactivity keys need an explicit application mapping. A Query tuple does not imply a Reactivity subscription. Native batching combines invalidations of the same Reactivity key. It does not guarantee one Query refresh across distinct keys.

An accepted monotonic cursor records invalidation intent. It does not establish durable delivery or successful reads. If supported, replay ordered events with duplicate suppression. Otherwise, refresh authoritative reads and explicitly reset the sequence. The application owns authentication, reconnect, replay storage, epochs, acknowledgments, and out-of-order delivery. For an ordered numeric cursor, `recoverStream` supplies optional duplicate suppression, cancellable backoff, replay-expiry refresh, gap hooks, and local connection state. Provide the native `connect` stream and recovery decisions. See [query patterns](query-patterns.md).

## Replace an owner in order

Partition results by safe tenant, user, backend, session, and permission-generation identity in `keyPrefix`. Keep credentials out of keys. Capture the retiring owner, then unmount its consumers. Mark it inactive and stop new work. Cancel queries and drain accepted mutations and local streams before releasing ready-client resources. Only then acquire and mount the replacement.

Apply this sequence even when semantic identity stays the same. Changing a provider client prop alone does not replace hook ownership. Guard late commit, rollback, and settlement callbacks even after draining work.

An accepted command can finish remotely during retirement. Completed work persists. To stop future domain work, use an explicit application command-cancellation operation. Local retirement supplies neither rollback nor acknowledgment of remote cancellation. A hanging request or finalizer can delay handoff. For an operation-ID protocol with separate start, progress, and cancel calls, use the [cancellable commands example](https://ueberbrot.github.io/effect-api-query/examples/cancellable-commands/).

For reload persistence, allowlist a validated DTO view. Repeat the safe owner tuple in its envelope and include version busters for schemas and keys. Restore only matching identities through freshly generated keys. Before writing, discard foreign or incompatible data. Avoid persisting pending optimistic values, arbitrary caches, errors, mutations, credentials, or class prototypes. For rich values, use paired codecs.

During explicit disposal, expose storage failures while completing resource cleanup. Lifecycle callbacks such as pagehide or HMR must handle a rejected disposal Promise. Otherwise, it becomes an unhandled rejection. Preserve the chosen reload-persistence policy and cleanup order.

Sources: [defaults and policies](https://ueberbrot.github.io/effect-api-query/guides/query-defaults/), [cache keys and filters](https://ueberbrot.github.io/effect-api-query/guides/cache-filters/), [optimistic writes](https://ueberbrot.github.io/effect-api-query/guides/optimistic-writes/), [owner replacement](https://ueberbrot.github.io/effect-api-query/guides/switch-cache-owners/), [event refresh](https://ueberbrot.github.io/effect-api-query/guides/refresh-from-events/).
