---
title: Apply Events to a Scoped Cache
description: Recover application events and update the active query owner's native cache.
---

Use `runQueryEvents` to register sequential event consumption with a [query owner](/effect-api-query/guides/switch-cache-owners/). Pass a decoded source, handlers and an application runner. The helper provides that owner's `QueryClientService` to the source, recovery hooks and handlers. It creates no transport or cached event history.

## Acquire and consume

This module reuses the directory contract from [Compose QueryClient Operations in Effect](/effect-api-query/guides/query-effects/). Supply a connection whose snapshot includes the replay cursor for those users. Its close function releases the acquired connection. The application protocol uses decimal string positions, complete user events and three reconnect attempts. Change these policies to match your server.

```ts
import {
  acquireQueryOwner,
  createQueryFilter,
  createRpcQueryUtils,
  queryEffects,
  recoverStream,
  runQueryEvents,
} from "@ueberbrot/effect-api-query";
import { Cause, Effect } from "effect";
import type { Stream } from "effect";
import type { RpcClient, RpcGroup } from "effect/rpc";

import { directory } from "./query-effects";

export interface DirectoryEvent {
  readonly position: string;
  readonly id: number;
  readonly name: string;
}

/** The application supplies its decoded transport and authoritative snapshot protocol. */
export interface DirectoryConnection {
  readonly client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof directory>>;
  readonly connect: (
    cursor: string
  ) => Stream.Stream<DirectoryEvent, "expired" | "offline">;
  readonly refresh: Effect.Effect<
    {
      readonly cursor: string;
      readonly users: readonly { readonly id: number; readonly name: string }[];
    },
    "offline"
  >;
  readonly close: () => Promise<void>;
}

export const acquireDirectoryEvents = async (
  acquire: () => Promise<DirectoryConnection>
) => {
  const owner = await acquireQueryOwner(async (setup) => {
    const connection = await setup.acquire(acquire, async (value) => {
      await value.close();
    });
    const rpc = createRpcQueryUtils(directory, {
      client: connection.client,
      keyPrefix: ["directory-events"],
      runPromiseExit: setup.wrapRunner(Effect.runPromiseExit),
    });
    return { connection, rpc };
  });
  const { connection, rpc } = owner.resources;
  const reads = createQueryFilter(rpc.users.read, "query");
  const invalidate = queryEffects.invalidate({
    ...reads(),
    refetchType: "none",
  });
  const source = recoverStream({
    initialCursor: "0",
    // This application's protocol uses decimal positions, represented as strings.
    cursorPolicy: {
      accept: (previous, next) => BigInt(next) > BigInt(previous),
      isGap: (previous, next) => BigInt(next) > BigInt(previous) + 1n,
    },
    connect: connection.connect,
    cursor: (event) => event.position,
    retryDelay: (_cause, attempt) => (attempt <= 3 ? "100 millis" : undefined),
    isReplayExpired: (cause) =>
      Cause.hasFails(cause) && Cause.squash(cause) === "expired",
    onGap: () => invalidate,
    onReplayExpired: () =>
      Effect.gen(function* onReplayExpired() {
        const snapshot = yield* connection.refresh;
        for (const user of snapshot.users) {
          yield* queryEffects.setData(
            rpc.users.read.queryKey({ id: user.id }),
            user
          );
        }
        yield* invalidate;
        return snapshot.cursor;
      }),
  });
  const completion = runQueryEvents(
    owner,
    source,
    {
      onEvent: (event) =>
        Effect.gen(function* onEvent() {
          yield* queryEffects.setData(
            rpc.users.read.queryKey({ id: event.id }),
            {
              id: event.id,
              name: event.name,
            }
          );
          yield* invalidate;
        }),
    },
    Effect.runPromiseExit
  );
  return { owner, completion };
};
```

Call `await acquireDirectoryEvents(acquireConnection)` with your transport acquisition function. Provide the returned `owner.queryClient` to native Query hooks or observers and use `owner.resources.rpc` for generated options. Inspect the returned `completion` promise's complete Effect Exit for stream, handler or recovery failures. A failed consumption stops event delivery; dispose the owner when leaving the application boundary.

On logout or replacement, call `await owner.dispose()`. Retirement stops admission, interrupts consumption, retry sleeps and refresh Effects, and waits for stream cleanup and the exit callback before releasing the connection. Keep the originating owner captured throughout the workflow. The runner must honor its AbortSignal and await Effect finalizers. Promise rejection from admission or the runner remains a rejection; it is not converted into an Effect failure.

## Choose recovery and cache policy

Handlers run sequentially and apply backpressure. A handler failure stops consumption and retains its complete Cause. Recovery handles source failures; it does not retry downstream handlers. Cleanup completes before `onExit`. Supply additional Effect services through the runner; the helper supplies only the owner's QueryClient.

The recipe replaces a user through its generated key and marks the generated read filter stale without starting refetches. A gap invalidates potentially missed users. Expired replay refreshes authoritative users and returns their matching cursor before reconnecting. Applications with deletions or partial snapshots must explicitly remove or refresh affected queries as well. Relationships between events and queries remain application policy.

`recoverStream` advances its local cursor before delivering an event. This is neither a durable acknowledgement nor a downstream processing checkpoint. A failed update can leave earlier writes in place. Choose transaction, checkpoint and restart policies in the application. See [Reconnect Streams](/effect-api-query/guides/reconnect-streams/) for recovery semantics.

Keep asynchronous work inside the awaited Effects. Detached work and uninterruptible callbacks can outlive retirement; capture the originating cache and use `owner.commit` for external synchronous writes. When refresh uses native Query fetches, wrap generated runners and query execution as described in [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/), so disposal also drains shared Query execution after the refresh waiter is interrupted.

Consume events without retention when they only update query data. If the UI needs recent event history, use an [accumulated streamed query with finite retention](/effect-api-query/guides/choose-stream-history/). Cache history separately only for that explicit requirement.
