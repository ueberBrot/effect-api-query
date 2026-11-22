---
title: Apply Events to a Scoped Cache
description: Recover application events and update the active query owner's native cache.
---

Use `runQueryEvents` to consume events in order inside a [query owner](/effect-api-query/guides/switch-cache-owners/). Pass a decoded source, handlers, and a runner. The helper supplies the owner's `QueryClientService` to the source, recovery hooks, and handlers.

## Acquire and consume

This example uses the [directory contract](/effect-api-query/guides/query-effects/). Supply a connection that returns users with the matching replay cursor and can close itself. The example uses decimal string cursors, complete user events, and three reconnect attempts. Match those choices to your server.

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
      runtime: setup.wrapRunner(Effect.runPromiseExit),
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

Call `await acquireDirectoryEvents(acquireConnection)`. Give hooks the returned `owner.queryClient` and build options from `owner.resources.rpc`. Inspect `completion` for the complete Effect Exit. A stream, handler, or recovery failure stops delivery. Dispose of the owner when you leave the application boundary.

On logout or replacement, await `owner.dispose()`. Retirement stops new work, interrupts consumption, backoff, and refresh, then waits for cleanup and the exit callback before closing the connection. Keep the original owner captured. The runner must honor the abort signal and await finalizers. Admission or runner Promise rejections remain rejections.

## Choose recovery and cache policy

The helper waits for each event handler before pulling the next event. A handler failure stops delivery and preserves its Cause. Recovery retries source failures; handlers run once per delivery. `onExit` follows cleanup. Provide any additional Effect services through the runner.

The example replaces one user by exact key and marks related reads stale without refetching. A gap invalidates potentially missed users. If replay expires, fetch authoritative data and return its matching cursor. For deletions or partial snapshots, decide which entries to remove or refresh.

`recoverStream` advances the cursor before downstream delivery. A failed update can leave earlier writes in place. Define transactions and durable processing checkpoints in the app. See [reconnect streams](/effect-api-query/guides/reconnect-streams/) for cursor behavior.

Keep asynchronous work inside awaited Effects. Detached or uninterruptible work can outlast retirement. Use `owner.commit` for external synchronous writes. If recovery uses native fetches, [track runners and query functions](/effect-api-query/guides/switch-cache-owners/#opt-in-owner-helper) so disposal waits for shared work after the refresh waiter stops.

If events only update queries, consume them directly. If the UI needs recent events, use an [accumulated stream with finite retention](/effect-api-query/guides/choose-stream-history/).
