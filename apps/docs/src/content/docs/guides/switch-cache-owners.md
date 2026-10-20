---
title: Switch Cache Owners
description: Isolate private queries, pending writes, and persisted directory data when an owner changes.
---

Include every safe identity that changes a result in the key prefix: tenant, user, session generation, and permission generation. Use application identifiers and numeric generations. Keep bearer credentials out of keys and storage names. A permission change needs a new generation, even when the user and tenant stay the same. These values partition caches. The server still owns authorization.

## Capture one owner

In a consumer or mutation module, receive the ready `application` returned by [`startViteReactApplication(options)`](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts). Capture the application, its existing utility trees, and its QueryClient:

```ts
const owner = application;
const { queryClient, rpcQuery: rpc, httpQuery: http } = owner;
```

The application uses `ownerKeyPrefix(identity)` from its [owner-cache module](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/owner-cache.ts) in both factories. It acquires clients, restores directory data, and exposes the original owner's guards and tracked mutation options. Keep its Scopes and runtimes alive until the owner's work finishes.

In this owner's mutation options, guard each cache write and invalidation:

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
        rpc.users.get.queryKey({ id: user.id, locale: user.locale }),
        user
      );
      await invalidateUsers();
    },
    onSettled: invalidateUsers,
  })
);
```

The success callback captures its original owner. Before seeding a concrete query, it checks that the owner is active. Settlement invalidation uses the same guard. An old callback never looks up a current application variable to choose where to write. Guard rollback, optimistic writes, manual cache updates, and any work after an `await` too.

## Replace the consumer boundary

The [existing Vite application](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts) provides `startViteReactApplication(options)`. Capture `previous` and unmount its consumer tree. Await `previous.dispose()` before starting and rendering the replacement application. The old owner retires before the new clients, QueryClient, and utilities are constructed. If acquisition fails, the old owner remains inactive. Handle the failure in the surrounding application. When reconnecting clients with an unchanged semantic identity, use the same unmount, retirement, and replacement sequence.

[ViteReactExample](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/app.tsx) keys its QueryClientProvider by a component key that changes with the application QueryClient. Replacing that client remounts query and mutation consumers, even when the safe semantic identity stays the same. The component key is not part of query keys or persistence. Passing a new QueryClient through an existing provider alone does not replace the QueryClient captured by existing hooks.

Reassigning options on a pending MutationObserver can also replace its callbacks. Capture the original owner in mutation context. Replace observers at the handoff. This recipe does not cover arbitrary observer reassignment.

Retirement immediately marks the captured owner inactive and removes its persisted snapshot. It cancels old queries and streams, clears both native caches, and waits for accepted mutation requests to settle. The application then releases its HTTP runtime and RPC client Scope. Complete local stream cleanup before acquiring the next owner. Native `cancelQueries()` settlement alone is not a finalizer acknowledgement, and local disposal is not a remote server acknowledgement.

The example attempts mutations immediately with `networkMode: 'always'` and `retry: false`. It does not keep an offline mutation queue. `runMutation` tracks requests that have started. New requests are rejected after retirement. Requests already accepted can complete on the server. Switching owners does not undo them. Their `onSuccess` or `onSettled` callbacks can finish after the request drain, so the ownership guard remains necessary.

A hanging request or local finalizer can delay the handoff. This policy supplies no completion deadline. Do not introduce serialized mutation queues without an explicit ownership and shutdown policy.

## Restore a directory snapshot

Pass application-approved Storage to the Vite application through `directoryStorage`. The browser entry uses sessionStorage. `persistDirectory()` writes only the RPC and HTTP `users.list` DTOs: arrays of `{ id: number, name: string, locale: string }`. It stores no mutations, errors, arbitrary query keys, classes, streams, infinite pages, or bearer credentials. A pending mutation removes the stored snapshot so an optimistic directory cannot be reused after reload.

Storage names include the full safe owner tuple. Each envelope repeats that identity and includes `schemaVersion: 1` and `keyVersion: 1`. Restoration validates the complete envelope and all DTO entries. It checks both busters and all owner fields, then writes through keys derived by the current utilities. Before any cache write, it deletes foreign or incompatible data. It never reads a different owner's storage slot.

When DTO meaning changes, bump the schema buster. When the persisted view's key contract changes, bump the key buster.

Restored DTOs are plain data with `dataUpdatedAt: 0`, so ordinary queries refetch them. Class constructors and methods are not restored by this recipe. If the domain requires them, use a paired codec from [Hydrate Unary Data](/effect-api-query/guides/hydrate-unary-data/).

Default `dispose()` and owner switches erase persistence. The browser's pagehide cleanup explicitly uses `dispose({ discardPersistence: false })` to snapshot a settled directory for a reload while retiring the old owner in memory and releasing its clients. Persistence calls from the old owner do nothing. Explicit disposal rejects on storage failure after query, cache, and client cleanup runs. The pagehide and HMR callbacks await that cleanup and report a rejection through the console.

Accepted tracked commands finish before a replacement owner is acquired. Retiring their client owner does not undo server work. If cancellation is required, use the explicit command cancellation operation.
