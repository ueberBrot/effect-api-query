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

## Opt-in owner helper

Use `acquireQueryOwner` when the application wants a small resource registry and drain boundary. The [complete native provider example](/effect-api-query/guides/react-query/) acquires a runtime, builds normal utilities with `setup.wrapRunner` and a `setup.runQuery(next, context.signal)` query interceptor, mounts QueryClientProvider, and unmounts before awaiting disposal. Each call creates an independent QueryClient; cache configuration is the second argument. Never reuse a retired owner or expose a replacement cache through a mutable callback variable.

Register each owned resource with awaited `setup.acquire(start, release)`. Release handlers run once in reverse acquisition order, including when later setup fails. `setup.borrow(value)` transfers no ownership. Keep acquisition sequential and awaited; do not retain the setup registrar or launch detached acquisitions. Effect Scope finalizers still manage resources inside an acquired runtime or client Scope.

`dispose()` marks the owner inactive synchronously. All repeated calls share its promise and outcome. It aborts registered query runners, cancels native queries, waits for the registered promises (including local stream finalizers), clears its native caches, then releases acquired resources. Every generated query/stream must use `setup.wrapRunner(runtime.runPromiseExit)` and a query-function interceptor `async ({ next, context }) => await setup.runQuery(next, context.signal)` in `configureUtils` for each used view (`query`, `infinite`, `metadata`, `streamed`, `live`). Stream pulls outlive the runner that creates their iterator; `runQuery` tracks the complete function and cleanup. the runner must honor AbortSignal and resolve only after local finalizers. A query runner is recognized by its supplied signal. Calls without a signal are drained without interruption.

For mutations, wrap the **complete native promise**, for example `owner.runMutation(() => mutation.mutateAsync(input))` or `owner.runMutation(() => observer.mutate(input))`. Acceptance occurs synchronously when `runMutation` is called while active; the registered callback starts in the next microtask. Disposal waits for that promise and its awaited callbacks, not detached work or per-call fire-and-forget callbacks. Wrapping only `mutationFn` accepts and drains just the request attempt. Native hooks remain unchanged. Use `networkMode: "always"` and `retry: false` for this immediate-attempt recipe; paused/offline queues and serial scopes need an application shutdown policy. A runner attempt that has not started before retirement is rejected, even if an outer accepted callback is still awaiting `onMutate`. Draining guarantees settlement, not successful execution.

Use `owner.commit(cache => { /* synchronous cache update */ })` in late callbacks. It skips updates after retirement and always captures the originating cache. Use `isActive()` for persistence, invalidation, and other application side effects. These guards cannot control arbitrary detached callbacks, external references, or an application callback deliberately writing to another owner's cache. Remount providers and observers during user/tenant replacement; unmount, retire and await cleanup before acquiring and rendering the replacement. Query keys and persistence still need the application's semantic user/tenant identity.

A rejected promise still pending at retirement is reported by disposal, while the original caller also receives its failure. A failed Effect Exit keeps its complete Cause for the adapter; a non-interruption-only Cause observed during retirement is also included in disposal failure. Already settled operation failures are not replayed. All releases are attempted after the drain, even if draining failed; their errors are collected in an AggregateError. Startup failure plus release failure produces an AggregateError containing both. Repeated disposal returns the same failure rather than retrying releases. A hanging accepted promise or finalizer delays disposal indefinitely: no hidden timeout releases a transport under running work. Surface disposal errors at the application boundary and define an explicit deadline/abandonment policy if needed.

Retirement does not cancel a domain command or roll back a mutation. Use an explicit cancellable-command protocol for that. Local query/stream cleanup is not a remote acknowledgment of cleanup, cancellation, or rollback. Ready clients, lifecycle-neutral factories and ordinary reactive options rebuilding remain available without this helper.

Normal aborted-query interruption (including an empty live query at cancellation) is excluded from drain failures; finalizer defects and typed failures remain visible. Pass the native query context signal to `runQuery` so this classification remains local to the cancelled query.
