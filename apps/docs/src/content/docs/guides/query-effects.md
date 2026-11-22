---
title: Compose QueryClient Operations in Effect
description: Run queries and manage the application's existing cache from Effect.
---

Use `queryEffects` to read and update your application's QueryClient from Effect. Provide the same client your hooks use through `QueryClientService`. Keep ownership and cleanup in the app.

## Share the application cache

This module takes a ready RPC client and the app's QueryClient. It loads a user if needed, updates the cached value, and marks directory reads stale. Run the Effect in your app's runtime. Keep the ready client alive until shared query work stops.

```ts
import type { QueryClient } from "@tanstack/query-core";
import {
  bindReactivityInvalidation,
  createRpcQueryUtils,
  queryEffects,
  QueryClientService,
} from "@ueberbrot/effect-api-query";
import { Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

export const directory = RpcGroup.make(
  Rpc.make("users.read", {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    error: Schema.Literal("missing"),
  })
);

export const directoryEffects = (
  client: RpcClient.RpcClient<RpcGroup.Rpcs<typeof directory>>,
  queryClient: QueryClient
) => {
  const rpc = createRpcQueryUtils(directory, {
    client,
    keyPrefix: ["directory"],
  });
  const renameFromEvent = Effect.fn("Directory.renameFromEvent")(
    function* renameFromEvent(id: number, name: string) {
      const options = rpc.users.read.queryOptions({
        input: { id },
      });
      const user = yield* queryEffects.query({
        ...options,
        staleTime: "static",
      });
      yield* queryEffects.setData(options.queryKey, { ...user, name });
      yield* queryEffects.invalidate(
        rpc.users.read.queryFilter({ view: "query", refetchType: "none" })
      );
      return yield* queryEffects.getData(options.queryKey);
    },
    Effect.provideService(QueryClientService, queryClient)
  );
  const bindUserRefresh = (id: number) =>
    bindReactivityInvalidation([
      {
        keys: [`users:${id}`],
        filter: rpc.users.read.queryFilter({ view: "query", input: { id } }),
      },
    ]).pipe(Effect.provideService(QueryClientService, queryClient));
  return { rpc, renameFromEvent, bindUserRefresh };
};
```

You can pass the returned `rpc` options to native hooks and QueryClient methods too. Providing a different QueryClient selects that cache. The app controls authorization, tenant keys, and owner retirement.

## Choose the operation

| Operation | Use |
| --- | --- |
| `query(options)` | Reuse fresh data or fetch it. Set `staleTime: "static"` to reuse data whenever the cache has it. |
| `infiniteQuery(options)` | Load paged data. To request multiple pages, set `pages` and supply `getNextPageParam`. |
| `prefetch(options)`, `prefetchInfinite(options)` | Warm the cache. Both discard the result and swallow query failures. |
| `streamSnapshot(options, controls?)` | Capture the first new publication or stream completion on an idle, unobserved query. |
| `getData(key)`, `getState(key)` | Read cached data or query state. Exact generated keys carry data and error types. |
| `setData(key, updater, options?)` | Supply a value or update the cached value immutably. Return `undefined` from an updater to skip the write. |
| `isFetching(filters?)` | Count matching queries that are fetching. |
| `invalidate(filters?, options?)` | Mark matches stale. Active matches refetch by default. Set `refetchType: "none"` to mark them stale without refetching. |
| `refetch(filters?, options?)` | Refetch matching queries under native QueryClient rules. |
| `cancel(filters?, options?)`, `remove(filters?)` | Cancel matching queries or remove their entries from the cache. |
| `reset(filters?, options?)` | Restore matching queries to their initial state and refetch active matches. |

`query` and `infiniteQuery` apply `select` to the returned value and cache the original data. Pass a concrete query key to reads and writes. For cache operations that take filters, pass native filters or use the utility's `.queryFilter()`.

## Handle failures and interruption

Fallible operations wrap the original failure in `QueryClientOperationError`. Treat its `cause` as `unknown`. If the original value is an adapter error, it retains the complete Effect Cause. Shared work can come from another caller, so inspect the cause before reading failure details.

Interrupting an Effect stops its wait for shared queries or refetches. Use `queryEffects.cancel` to cancel work for all waiters and observers. For a query owner, provide `owner.queryClient` and use `owner.trackUtils` so retirement waits for local cleanup. See [switch cache owners](/effect-api-query/guides/switch-cache-owners/).

For an open stream, use `streamSnapshot` to capture data before the stream ends. Interrupting its fiber or aborting its optional caller signal cancels the capture and starts local cleanup. See [stream snapshots](/effect-api-query/guides/stream-snapshots/).

## Invalidate queries from Effect Reactivity

Use `bindReactivityInvalidation` to connect Reactivity keys to TanStack Query filters. Build the filters from the utility tree so they retain its key prefix. The `bindUserRefresh` function above binds a single user to its exact filter and uses the application's QueryClient.

Run the binding inside the Scope that owns the subscription. Provide the same `Reactivity` service your writes use. With a query owner, supply `owner.queryClient` and pass `{ isActive: owner.isActive }` as the binding options. For server rendering, keep Reactivity and the binding request-local.

A binding accepts one filter or a readonly array of filters. Each binding runs once per microtask, even if multiple keys trigger it. Closing the Scope removes the listeners and drops queued work. Run `yield* bridge.flush` to wait for queued work and any native refetches that it starts.

Effect’s `keysToHashes` visits both the group and the qualified IDs for record keys. For example, `{ users: [1] }` visits `users` and `users:1`. A listener registered with `{ users: [2] }` also subscribes to `users`, so that write can trigger it. Register `["users"]` for broad invalidation and `["users:1"]` for an exact ID. A record write can trigger both. An array write to `["users:1"]` triggers listeners for that exact key.

Use a separate Reactivity instance for each independent query owner. Scopes remove subscriptions at retirement. If two active owners share a Reactivity instance, writes can reach both caches when their bindings use the same keys. Provide the owner’s instance to both the binding and its writers. The bridge drops `undefined` record entries and ignores empty bindings. Declare `Reactivity.Keys` in your application if you want stricter key types.

Set `invalidateOptions` for default QueryClient options. A binding's own `options` replace that default. Supply `onError` to receive QueryClient failures, including refetch rejections with `throwOnError: true`. The bridge continues to invalidate while mutations are pending. Coordinate optimistic writes in the application.
