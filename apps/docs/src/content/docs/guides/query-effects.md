---
title: Compose QueryClient Operations in Effect
description: Read, ensure, update, and invalidate the application's existing cache from Effects.
---

Use `queryEffects` to read and update your application's QueryClient from Effect. Provide the same client your hooks use through `QueryClientService`. Keep ownership and cleanup in the app.

## Share the application cache

This module takes a ready RPC client and the app's QueryClient. It loads a user if needed, updates the cached value, and marks directory reads stale. Run the Effect in your app's runtime. Keep the ready client alive until shared query work stops.

```ts
import type { QueryClient } from "@tanstack/query-core";
import {
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

// Supply the same ready client and QueryClient used by the application's providers.
export const directoryEffects = (
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof directory>>,
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
        select: (user) => user.name,
      });
      // ensure returns the full cached user, even though observers select its name.
      const user = yield* queryEffects.ensure(options);
      yield* queryEffects.setData(options.queryKey, { ...user, name });
      // Domain policy: mark all directory reads stale without starting refetches.
      yield* queryEffects.invalidate(
        rpc.users.read.queryFilter({ view: "query", refetchType: "none" })
      );
      return yield* queryEffects.getData(options.queryKey);
    },
    Effect.provideService(QueryClientService, queryClient)
  );
  return { rpc, renameFromEvent };
};
```

You can pass the returned `rpc` options to native hooks and QueryClient methods too. Providing a different QueryClient selects that cache. The app controls authorization, tenant keys, and owner retirement.

## Choose the operation

- `getData(key)` reads cached data or `undefined`. Exact generated keys infer data types. Broad prefixes infer `unknown`.
- `ensure(options)` returns cached data even when stale and fetches if absent. Set `revalidateIfStale` to refresh stale data in the background.
- `fetch(options)` uses `queryClient.query` for freshness, retries, deduplication, and cache writes.
- `setData(key, updater, options?)` uses `setQueryData`. Pass a new value or update it immutably. Return `undefined` to skip the write.
- `invalidate(filters?, options?)` uses `invalidateQueries`. Pass generated filters or prefixes. Active matches refetch by default. Use `refetchType: "none"` to mark them stale only. Refetch failures follow native `throwOnError`.

The Effects run when you provide `QueryClientService` and execute them. Fetch and ensure return the full cached data. Use `select` with native hooks, observers, or `queryClient.query` to project a result. Fetching a stream waits for completion. For the first visible data from an open stream, use a [stream snapshot](/effect-api-query/guides/stream-snapshots/).

## Handle failures and interruption

Each operation reports a native rejection as `QueryClientOperationError`. Its `cause` holds the original value, including any adapter error and its complete Effect Cause. Treat the rejection as `unknown`. A custom runner can reject with any value, and QueryClient can share work another caller started. Narrowing the wrapper does not establish the current query's declared failure type. Generated options retain that type for native consumers.

Interrupting an Effect stops that caller's wait. QueryClient retains its own abort signal and can continue running shared work after every waiter leaves. The same rule applies to already started invalidation.

Use native `cancelQueries` if the owner intends to stop shared work for all waiters and observers. Wait for local cleanup before releasing the client or runtime. See [cancellation](/effect-api-query/guides/cancellation/) and [switch cache owners](/effect-api-query/guides/switch-cache-owners/).

## Invalidate queries from Effect Reactivity

Use `bindReactivityInvalidation` to connect Reactivity keys to TanStack Query filters. Build the filters from the utility tree so they retain its key prefix. Import the bridge from `@ueberbrot/effect-api-query`. This example uses the `rpc` tree from `directoryEffects` above.

```ts
const bindDirectoryUser = (
  rpc: ReturnType<typeof directoryEffects>["rpc"],
  id: number
) =>
  bindReactivityInvalidation([
    {
      keys: [`users:${id}`],
      filter: rpc.users.read.queryFilter({ view: "query", input: { id } }),
    },
  ]);
```

Run the binding inside the Scope that owns the subscription. Provide the same `Reactivity` service your writes use and the cache as `QueryClientService`. With a query owner, supply `owner.queryClient` and pass `{ isActive: owner.isActive }` as the binding options. For server rendering, keep Reactivity and the binding request-local.

A binding accepts one filter or a readonly array of filters. Each binding runs once per microtask, even if multiple keys trigger it. Closing the Scope removes the listeners and drops queued work. Run `yield* bridge.flush` to wait for queued work and any native refetches that it starts.

Effect matches record keys such as `{ users: [1] }` on both the group name and the ID. A write to that group can trigger a binding for another ID. Use array keys such as `["users:1"]` for an exact match and separate Reactivity instances for independent owners. The bridge drops `undefined` record entries and ignores empty bindings. Declare `Reactivity.Keys` in your application if you want stricter key types.

Set `invalidateOptions` for default QueryClient options. A binding's own `options` replace that default. Supply `onError` to receive QueryClient failures, including refetch rejections with `throwOnError: true`. The bridge continues to invalidate while mutations are pending. Coordinate optimistic writes in the application.
