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
