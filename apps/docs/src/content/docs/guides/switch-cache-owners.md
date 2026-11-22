---
title: Switch Cache Owners
description: Isolate private queries, pending writes, and persisted directory data when an owner changes.
---

If data varies by tenant, user, session, or permissions, include safe values for those identities in the key prefix. Use a new permission generation when access changes. Keep bearer credentials out of keys and storage names. The server still authorizes requests.

## Capture one owner

Capture the app returned by [`startViteReactApplication(options)`](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts), its utility trees, and its QueryClient.

```ts
const owner = application;
const { queryClient, rpcQuery: rpc, httpQuery: http } = owner;
```

Both factories use `ownerKeyPrefix(identity)` from the [owner-cache module](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/owner-cache.ts). The app acquires the clients, restores saved directory data, and exposes the owner's write guards. Keep its Scope and runtime alive until its work settles.

Use the captured owner's guard for cache updates and invalidation.

```ts
const invalidateUsers = async () => {
  if (!owner.isActive()) {
    return;
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: rpc.users.key() }),
    queryClient.invalidateQueries({ queryKey: http.users.key() }),
  ]);
};
```

```ts
const createUser = owner.trackMutationOptions(
  rpc.users.create.mutationOptions({
    onSuccess: async (user) => {
      if (!owner.isActive()) {
        return;
      }
      queryClient.setQueryData(
        rpc.users.get.queryKey({ input: { id: user.id, locale: user.locale } }),
        user
      );
      await invalidateUsers();
    },
    onSettled: invalidateUsers,
  })
);
```

The success callback checks the original owner before seeding a query. Use the same guard after each `await`, including rollback and settlement. A late callback must use the owner it captured when the mutation began.

## Replace the consumer boundary

In the [Vite app](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts), capture `previous`, unmount its consumers, and await `previous.dispose()`. Then start and render the replacement. If acquisition fails, report the error from the app boundary. The previous owner stays inactive. Use the same sequence when reconnecting with unchanged identity.

[ViteReactExample](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/app.tsx) remounts consumers with a new React component key whenever the QueryClient changes. Existing hooks can keep their original cache if you only pass a new client to the provider. The React key is independent of query and storage keys.

MutationObserver can replace callbacks on a pending mutation. Capture the original owner in mutation context and remount the observer during the handoff.

Retirement marks the owner inactive and removes its saved snapshot. It cancels queries, drains local stream cleanup and accepted mutation requests, clears caches, then releases the HTTP runtime and RPC Scope. Wait for local cleanup before creating replacements. `cancelQueries()` can settle before finalizers finish. Wait for a separate server acknowledgement if you need one.

The example uses `networkMode: 'always'` and `retry: false` to start writes immediately. `runMutation` in the example tracks requests that have started and rejects new requests after retirement. Accepted server writes can still finish. Keep guards in `onSuccess` and `onSettled` because callbacks can run after the request drain.

A hanging request or finalizer delays the handoff. Define an explicit shutdown policy before using serial or paused mutation queues.

## Restore a directory snapshot

Pass approved Storage through `directoryStorage`. The browser example uses sessionStorage. `persistDirectory()` stores only RPC and HTTP `users.list` arrays of `{ id: number, name: string, locale: string }`. A pending write removes the snapshot so it cannot restore optimistic state after reload.

The storage name includes the safe owner tuple. The snapshot repeats it with `schemaVersion: 1` and `keyVersion: 1`. The app validates identity, versions, and all entries before deriving current cache keys. It removes incompatible data before writing to the cache and reads only the current owner's storage slot.

Bump the schema version if DTO meaning changes. Bump the key version if the persisted view's key changes.

Restored values use `dataUpdatedAt: 0` so ordinary queries refetch them. Use a paired [hydration codec](/effect-api-query/guides/hydrate-unary-data/) if you need class methods.

By default, disposal and owner switches erase persistence. The `pagehide` callback uses `dispose({ discardPersistence: false })` to save a settled directory before retiring the owner. Persistence calls from a retired owner do nothing. Disposal reports storage errors after cleanup. The pagehide and HMR callbacks report cleanup rejections to the console.

## Opt-in owner helper

Use `acquireQueryOwner` to register resources and wait for work at disposal. Each call creates a QueryClient with its own query and mutation caches. If you pass a cache in the configuration, the owner copies its callbacks into a fresh cache. See the [React provider example](/effect-api-query/guides/react-query/) for acquisition, tracking, and unmounting.

Await each `setup.acquire(start, release)` in order. Release handlers run once in reverse order, including after a later acquisition fails. With `setup.borrow(value)`, your app remains responsible for release. Finish acquiring resources during setup. Effect Scope still manages resources inside an acquired runtime or client.

`dispose()` marks the owner inactive immediately. Repeated calls share its promise. It aborts registered runners, cancels native queries, waits for registered work, clears caches, then releases acquired resources. Call `setup.trackUtils(utils)` during setup or `owner.trackUtils(utils)` afterward. It tracks the leaf runtime, the full query including stream cleanup, and the generated mutation function. You can apply `configureUtils` before or after tracking. The runner must honor the signal and await local finalizers. Work without a signal is drained without interruption.

Track the full native promise with `owner.runMutation(() => mutation.mutateAsync(input))` or `owner.runMutation(() => observer.mutate(input))`. It accepts work synchronously and starts the callback in the next microtask. Disposal waits for the request and awaited callbacks. Track only `mutationFn` if you intend to drain only that attempt. Use `networkMode: "always"` and `retry: false` for immediate attempts. An attempt that starts after retirement rejects even if its outer callback is already accepted. A drained mutation can still fail.

Use `owner.commit(cache => { /* synchronous cache update */ })` for late cache writes. It targets the original cache and skips retired owners. Use `isActive()` for invalidation, persistence, and other side effects. Keep detached work guarded as well. Remount providers on replacement and include safe user or tenant identity in keys and storage.

Disposal reports pending Promise failures and non-interruption-only Effect Causes observed while draining. Original callers also receive their failures. Already settled failures are not replayed. Releases run even if the drain fails. Release failures are collected in an AggregateError, including with a startup failure. A repeated disposal returns the original failure. A stalled promise or finalizer can delay cleanup indefinitely.

For server work, use an [explicit cancellation protocol](/effect-api-query/guides/cancellation/#request-server-cancellation-explicitly). Wait for an application acknowledgement if you need remote completion. You can also manage client lifetime yourself with the ordinary factories.

Pass the native query signal to `runQuery` so disposal can ignore ordinary interruption of the cancelled query. Include the HTTP metadata view if the owner uses it. Typed failures and finalizer defects still surface.
