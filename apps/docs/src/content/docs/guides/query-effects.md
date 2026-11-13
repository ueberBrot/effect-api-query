---
title: Compose QueryClient Operations in Effect
description: Read, ensure, update, and invalidate the application's existing cache from Effects.
---

Use `queryEffects` when application Effects need the same cache as native Query hooks and observers. Provide `QueryClientService` with the existing application QueryClient. The service creates no cache, runtime, transport, or Scope, and disposes nothing.

## Share the application cache

This complete application module accepts the ready RPC client and QueryClient already owned by the application. Its event workflow ensures a user, applies an immutable typed update, and marks generated directory filters stale. Run the returned Effect in the application's existing runtime; keep the ready client alive until shared Query work has stopped.

```ts
import type { QueryClient } from "@tanstack/query-core";
import {
  createQueryFilter,
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
  const allUsers = createQueryFilter(rpc.users.read, "query");
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
      yield* queryEffects.invalidate({ ...allUsers(), refetchType: "none" });
      return yield* queryEffects.getData(options.queryKey);
    },
    Effect.provideService(QueryClientService, queryClient)
  );
  return { rpc, renameFromEvent };
};
```

The returned `rpc` utilities can also be passed directly to native hooks or QueryClient methods. Supplying a different QueryClient selects that cache explicitly. Authentication, tenant partitioning, event acceptance, and owner retirement remain application policy.

## Choose the operation

- `getData(key)` reads cache data or `undefined`; concrete generated keys infer the decoded data. Broad prefixes infer `unknown`.
- `ensure(options)` delegates to native `ensureQueryData`: it returns cached data even when stale, fetching when absent. `revalidateIfStale` retains native background refresh behavior.
- `fetch(options)` delegates to native `fetchQuery`: freshness, retry, deduplication, and cache writes remain native.
- `setData(key, updater, options?)` delegates to native `setQueryData`; use an immutable value or updater. Returning `undefined` skips the write.
- `invalidate(filters?, options?)` delegates to native `invalidateQueries`. Generated filters and prefixes work directly. Active queries refetch by default; `refetchType: "none"` only marks them stale. Refetch failures follow native `throwOnError` behavior.

These operations are lazy Effects requiring `QueryClientService` until provided. Fetch and ensure return **unselected query data**, matching the cache. A builder's `select` remains available to hooks and observers but does not transform these results. This differs from the newer native `queryClient.query`, which applies selection. A streaming fetch or ensure waits for native completion; for a finite capture of an open stream, use [Stream Snapshots](/effect-api-query/guides/stream-snapshots/).

## Handle failures and interruption

Fetch and ensure fail with `QueryClientOperationError`. Its `cause` retains the exact original rejected value, including generated `EffectRpcQueryError` and `EffectHttpApiQueryError` objects with their complete Effect Causes. The bridge cannot infer the Cause's failure payload from the options: a runner can reject with any value, and native deduplication can share work started by another caller. A wrapper's class or tag does not prove that it came from the current query's failed Exit. Narrowing the wrapper identifies its shape; its failure payload remains `unknown`. The generated options still carry their declared error type for native consumers, while the bridge conservatively exposes the unknown rejection in `cause`. Reads, updates and invalidation use the same fallback channel. Data and service inference are unchanged.

Interrupting a caller stops **only its wait**. It does not call `cancelQueries`, forward the caller's abort signal to the query function, or unsubscribe unrelated observers. Shared work can complete and publish after every Effect waiter has left. Deduplication and QueryClient-owned abort signals remain native. The same rule applies while awaiting invalidation refetches; already-started invalidation is not rolled back.

The cache owner may explicitly call native `cancelQueries` when it intends to cancel shared work. That action also affects other waiters and observers. Cancel and drain owned work before releasing the ready client or runtime; interrupting this bridge's waiter does not establish cleanup or remote acknowledgement. See [Cancellation](/effect-api-query/guides/cancellation/) and [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/).
