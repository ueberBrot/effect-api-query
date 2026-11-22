# Defaults, filters, writes, and cache owners

## Register native defaults and filters

Build the QueryClient and utilities once per owner. Register global defaults, then prefixes from broad to specific. TanStack merges them in registration order. Omit a field to inherit it. Explicit `initialData: undefined` clears an inherited seed. `staleTime: 0` overrides freshness. Keep selection and input at the call site.

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

Use `createQueryFilter` to bind a leaf and view to a projection into the actual key shape. By default, the projection takes the leaf's input. Annotate its parameter for a scalar or partial input. Return strict JSON. The helper copies and freezes it without running the constructor or filling defaults. Omit the projection to match the whole view with native conditions.

`everyLocale` matches the encoded string ID for all locales. The concrete key fills in `locale: 'en'`. Match the output of the active encoder. Default HTTP keys keep request labels and lowercase headers. If an encoder returns only a scalar, use a broad prefix or exact key.

Pass generated prefixes to native `invalidateQueries` or `cancelQueries`. Invalidation marks matching entries stale and refetches active matches by default. A view prefix covers every input and policy in that view. It is frozen and has no DataTag. Use exact generated keys for typed reads and writes. Stream keys include policy.

Hooks, observers, and `queryClient.query` apply selection. The cache retains decoded data. Set hashing through QueryClient global or prefix defaults and keep it stable. Per-call hashes are rejected. Streams fail with `UnsupportedQueryHash` if a default hash or cached identity conflicts. Retire the cache before changing hashing. Mutation keys and defaults are separate.

Bind a branch and view with `const userReads = createBranchQueryFilter(rpc.users, "query")`. Then pass `userReads()` to `queryClient.invalidateQueries`. Pass native conditions to `userReads` to narrow the match. Omit `exact` to include descendants. Absent views match nothing.

Use `findDeclaredError(error, tag)` for one tagged failure in a typed union. Composite Causes, defects, interruption, and unrelated errors return None. Keep the original wrapper and classify retry policy separately.

## Assemble contract-associated policies

Use `defineUtilsPolicy<UtilityType>()(configuration)` when reuse starts before client acquisition. Derive the type from `RpcQueryUtils` or `HttpApiQueryUtils` with the actual declaration, prefix, and client error information. Apply it to the matching scope with `configureUtils`. Literal defaults such as retention remain visible to builders.

Keep the declaration shared. Put policy values, callbacks, cache access, and runtime choices in the app. The policy map retains literals and checks paths, views, and fields. `configureUtils` copies policy values and interceptor arrays. Keep retained values and dependencies unchanged. Leaf callbacks keep concrete types. Optimistic context stays local.

Set SSE decoder defaults on the SSE leaf's `streamed.policy.sseOptions` or `live.policy.sseOptions`, including inside a `scoped` map. `configureUtils` copies those settings for both keys and options.

For the full example, see [defaults and policies](https://ueberbrot.github.io/effect-api-query/guides/query-defaults/).

## Configure shared behavior

Use `{ policy, interceptors }` for a query view. Add `callbacks` for mutations and `scoped` for specific children. `configureUtils` returns frozen copies with the same keys and prepared-input owner.

Configure once per owner and reuse across renders. Frozen subtrees can be shared when their settings stay the same. Empty policy and interceptor lists add nothing. Explicit undefined settings and callback modes still affect merging.

This factory shares freshness and invalidates the affected reads after a mutation.

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

Use the same contract to run an authorization check before writing.

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

Leaf callbacks get the view's data and error types, or the mutation's result and variables. Use `QueryPolicy<typeof leaf, View>` or `MutationPolicy<typeof leaf>` for reusable policies. Shared tree and branch callbacks get `unknown` because their leaves can differ.

Defaults apply from QueryClient to tree, branch, leaf, and call site. Keep input, selection, initial and placeholder data, page mapping, adapter controls, and optimistic context local. Set history controls in `streamed.policy` to share them between options and keys.

More specific mutation callbacks replace broader callbacks by default. Set `mutation.callbacks: "compose"` to run the shared callback first, then the narrower one. This applies to `onSuccess`, `onError`, and `onSettled`. A rejection stops the pair and follows TanStack's error handling. Define `onMutate` at the call site to retain its result type.

A scope's composed callbacks remain active if a narrower scope uses replacement.

An explicit JavaScript `undefined` callback override clears that callback's composed defaults.

Interceptors wrap every execution attempt, including retries. They run tree, branch, then leaf, with the first entry outermost. Call `next` at most once. For pagination it returns one page. Mutation interceptors also receive input, and a direct call has no native context. Forward the query signal. Skipped queries stay disabled.

Repeated calls keep scope order. At the same scope, later policies win and earlier interceptors stay outermost.

At one mutation scope, later callbacks replace earlier ones. The latest supplied mode applies to the merged policy. Configured trees still fit consumers of the original type.

Use `satisfies UtilsConfiguration<typeof tree>` to keep literal settings such as required retention in the type.

Type-check a call with selection, conditional input, or local optimistic context. For bounded typed retries, use the [retry recipe](https://ueberbrot.github.io/effect-api-query/guides/retry-queries/).

## Share equivalent decoded values

Keep native sharing by default. For immutable decoded class instances, dates, or collections, follow [share decoded values](https://ueberbrot.github.io/effect-api-query/guides/share-decoded-values/). Use `schemaStructuralSharing(Reading, { equivalence: Schema.toEquivalence(Reading) })` for a single decoded record. Compare meaningful extra state in the equivalence.

The helper compares array positions and keeps whole class instances. Equivalent values reuse the previous reference. For unknown fields that need reference equality, use `Schema.overrideToEquivalence(() => Equivalence.strictEqual())`. Keep compared data unchanged. The helper traverses plain acyclic objects and dense arrays with enumerable string data properties. Unsupported values pass through. Traversed cycles throw. Validation and equivalence must run synchronously without services.

The same callback works inside a metadata envelope. Fetched envelopes and raw headers stay frozen. Initial, manual, hydrated, and selected values keep their usual ownership. Check references through an observer or `getQueryData`. Measure both equal and changed data.

## Coordinate overlapping optimistic writes

Route each write through this app workflow.

1. Capture the owner and reserve the write in `onMutate` before awaiting anything. Cancel affected reads before publishing.
2. Save affected entities and positions. Keep unrelated entries, pages, and `pageParams`. Give each creation a temporary ID. After a refresh, use current positions for new deletions.
3. Return the original owner's commit, rollback, and settlement actions. Check that owner after every await and before updating the cache.
4. On success, replace only this write's optimistic value. Seed generated keys with the returned identity, such as locale.
5. On failure, remove this write's temporary entry or restore the deleted entity beside surviving neighbors. Preserve later writes and authoritative revisions, even if the data reference matches. Coordinate overlapping deletions of one entity.
6. Reconcile when the last overlapping write settles. Cancel an earlier reconciliation before publishing a new write.

An options update can replace pending callbacks or a mutation function that has yet to start. Capture the original actions in mutation context and remount consumers when owners change. For server ordering or external cache writes, define an app conflict policy.

## Refresh from application events

Map authenticated, decoded events to generated filters. Name both roots if RPC and HTTP share a domain. Capture one owner per consumer Scope. Unregister listeners on closure and check the owner again after awaits.

Queue invalidation during participating writes and flush after settlement. A broad refresh can cover narrower reads. Map Reactivity keys explicitly to Query filters. Reactivity batching for one key does not merge refreshes across keys.

A cursor records local acceptance of an invalidation request. Replay ordered events with duplicate suppression if the server supports it. Otherwise refresh current state and reset the sequence explicitly. See [stream recovery](query-patterns.md#recover-an-application-owned-stream) for reconnect hooks and cursors.

## Replace an owner in order

Use safe identities in `keyPrefix`, including tenant, user, backend, session, or permission generation if they affect data. Keep credentials out of keys. Capture and unmount the old owner, stop admission, cancel queries, and wait for accepted mutations and local cleanup. Release resources before acquiring and mounting a replacement.

Remount consumers even when identity stays the same because hooks can retain the old QueryClient. Guard late commit, rollback, and settlement callbacks.

Accepted commands can finish during retirement. Use an [explicit command operation](https://ueberbrot.github.io/effect-api-query/examples/cancellable-commands/) to stop future server work. A hanging request or finalizer delays handoff.

Persist only approved DTO views. Include safe owner identity and separate schema and key versions in the saved envelope. Validate it before restoring with newly generated keys. Discard incompatible data. Leave out optimistic values, mutations, errors, credentials, and unrelated entries. Use paired codecs for rich values.

Finish resource cleanup even if storage fails. Handle disposal rejections from explicit shutdown, pagehide, and HMR.

See [cache filters](https://ueberbrot.github.io/effect-api-query/guides/cache-filters/), [optimistic writes](https://ueberbrot.github.io/effect-api-query/guides/optimistic-writes/), [owner replacement](https://ueberbrot.github.io/effect-api-query/guides/switch-cache-owners/), and [event refresh](https://ueberbrot.github.io/effect-api-query/guides/refresh-from-events/) for complete examples.

## Compose cache operations in Effect

Provide the application's existing QueryClient as `QueryClientService`. Run `queryEffects.getData` and `setData` with exact keys, `fetch` or `ensure` with generated options, and `invalidate` with generated filters. Provide the service with `Effect.provideService` or a Layer.

Fetch and ensure use `queryClient.query` and return the full cached data. `fetch` follows native freshness rules. `ensure` returns cached data even when stale and fetches if absent. Set `revalidateIfStale` for background refresh. Use a snapshot for open streams. Write immutably and return `undefined` to skip a write. Invalidation keeps native refetch and `throwOnError` behavior.

On native failure, inspect `QueryClientOperationError.cause` as `unknown`. It preserves the original rejection, including any execution wrapper and full Cause. Shared work can come from another caller. The wrapper's class alone cannot prove the current options' declared failure type.

Interrupting an Effect stops its wait. QueryClient can finish shared work and publish for observers. Cancel native queries only when the owner wants to stop that shared work. See [query effects](https://ueberbrot.github.io/effect-api-query/guides/query-effects/) for examples.

## Opt in to query owner setup

Use `acquireQueryOwner` to create independent query and mutation caches and register resources. Supplied caches contribute their callback configuration. Await each `setup.acquire(start, release)` in order. Releases run in reverse order, even if setup fails. Use `setup.borrow(value)` when the caller retains ownership.

Wrap the runner with `setup.wrapRunner`. For each used view, configure an interceptor that calls `setup.runQuery(next, context.signal)`. This tracks the complete function because stream pulls outlast iterable creation. See [React setup](https://ueberbrot.github.io/effect-api-query/guides/react-query/) and [retirement](https://ueberbrot.github.io/effect-api-query/guides/switch-cache-owners/#opt-in-owner-helper).

Use `owner.runMutation(() => mutation.mutateAsync(input))` to wait for the request and awaited callbacks. Wrapping `mutationFn` only tracks that attempt. Use `networkMode: "always"` and `retry: false` for immediate attempts. Offline queues need an app policy. A runner that starts after retirement rejects even inside an accepted mutation.

Use `owner.commit` for synchronous late writes and `isActive()` for other side effects. Unmount, dispose, then acquire and mount the replacement. Disposal stops admission, cancels queries, waits for tracked work, clears caches, and releases acquired resources. Repeated calls share the result. It reports pending failures and attempts all releases. Borrowed resources stay open. A stalled finalizer delays disposal.

Pass the native signal to `runQuery` and track every view you use, including HTTP metadata. Disposal ignores ordinary interruption of cancelled work. Typed failures and finalizer defects still surface.

## Scoped event consumption

Run `runQueryEvents(owner, source, options, runPromiseExit)` with your source and optional recovery. Map events to exact updates and filter invalidation. The helper supplies the owner's cache to the source and hooks. It awaits each handler. Inspect the complete Exit. Admission or runner rejection stays a rejected Promise.

Keep the runner signal-aware and await its finalizers. Retirement stops consumption, backoff, and refresh. Use the original owner's guard for external writes. If refresh starts shared native queries, track both their runners and complete executions. See [scoped event consumption](https://ueberbrot.github.io/effect-api-query/guides/scoped-event-cache/).

Recovery advances before downstream handling. A handler failure stops delivery. Earlier writes remain. Persist processing checkpoints under app policy. After replay expiry, return the refreshed snapshot's cursor. Keep bounded event history only if the UI needs it.
