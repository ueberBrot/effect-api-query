import { Cause, Effect, Exit, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  acquireQueryOwner,
  queryEffects,
  QueryClientOperationError,
  recoverStream,
  runQueryEvents,
} from "#effect-api-query";

import { directory } from "../examples/shared/query-effects";
import { acquireDirectoryEvents } from "../examples/shared/query-events";
import { makeRpcTestClient } from "./fixtures/effect-rpc";

const gate = () => {
  let open!: () => void;
  // oxlint-disable-next-line promise/avoid-new
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

describe("owner event consumption", () => {
  it("applies ordered recovered events sequentially to the owner's native cache without retaining history", async () => {
    const owner = await acquireQueryOwner(
      async () => await Promise.resolve(null)
    );
    const source = recoverStream({
      initialCursor: "0",
      cursorPolicy: { accept: (previous, next) => next > previous },
      connect: () =>
        Stream.make(
          { cursor: "1", value: "Ada" },
          { cursor: "1", value: "duplicate" },
          { cursor: "2", value: "Grace" }
        ),
      cursor: (event) => event.cursor,
      retryDelay: () => {},
    });
    const seen: string[] = [];
    const exit = await runQueryEvents(
      owner,
      source,
      {
        onEvent: (event) =>
          Effect.gen(function* onEvent() {
            yield* queryEffects.setData(["user"], event.value);
            seen.push(event.value);
          }),
      },
      Effect.runPromiseExit
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(seen).toStrictEqual(["Ada", "Grace"]);
    expect(owner.queryClient.getQueryData(["user"])).toBe("Grace");
    expect(owner.queryClient.getQueryCache().getAll()).toHaveLength(1);
    await owner.dispose();
  });

  it("awaits each handler before pulling another event and preserves handler failure after cleanup", async () => {
    const owner = await acquireQueryOwner(
      async () => await Promise.resolve(null)
    );
    const entered = gate();
    const resume = gate();
    const order: string[] = [];
    const result = runQueryEvents(
      owner,
      Stream.make(1, 2).pipe(
        Stream.rechunk(1),
        Stream.tap((value) =>
          Effect.sync(() => {
            order.push(`pulled ${value}`);
          })
        ),
        Stream.ensuring(
          Effect.sync(() => {
            order.push("cleanup");
          })
        )
      ),
      {
        onEvent: () =>
          Effect.gen(function* onEvent() {
            entered.open();
            yield* Effect.promise(async () => {
              await resume.promise;
            });
            return yield* Effect.fail("handler failed");
          }),
        onExit: () =>
          Effect.sync(() => {
            order.push("exit");
          }),
      },
      Effect.runPromiseExit
    );
    await entered.promise;
    expect(order).toStrictEqual(["pulled 1"]);
    resume.open();
    await expect(result).resolves.toStrictEqual(Exit.fail("handler failed"));
    expect(order).toStrictEqual(["pulled 1", "cleanup", "exit"]);
    await owner.dispose();
  });

  it.each(["consumption", "backoff", "refresh"] as const)(
    "retirement interrupts %s and drains cleanup before release without contaminating replacement",
    async (phase) => {
      const entered = gate();
      const finalizing = gate();
      const cleanup = gate();
      const order: string[] = [];
      const old = await acquireQueryOwner(
        async (setup) =>
          await setup.acquire(
            () => null,
            () => {
              order.push("release");
            }
          )
      );
      const next = await acquireQueryOwner(
        async () => await Promise.resolve(null)
      );
      next.queryClient.setQueryData(["user"], "replacement");
      const source = recoverStream({
        connect: () =>
          phase === "consumption"
            ? Stream.fromEffect(
                Effect.sync(() => {
                  entered.open();
                })
              ).pipe(Stream.flatMap(() => Stream.never))
            : Stream.fail("expired"),
        cursor: () => 1,
        retryDelay: () => (phase === "backoff" ? "1 hour" : 0),
        isReplayExpired: () => true,
        onReplayExpired: () =>
          Effect.gen(function* onReplayExpired() {
            entered.open();
            yield* Effect.promise(async () => {
              await gate().promise;
            });
            yield* queryEffects.setData(["user"], "late refresh");
            return 1;
          }),
        onState: (state) =>
          Effect.sync(() => {
            if (phase === "backoff" && state.status === "backing-off") {
              entered.open();
            }
          }),
      }).pipe(
        Stream.ensuring(
          Effect.promise(async () => {
            finalizing.open();
            await cleanup.promise;
            order.push("cleanup");
          })
        )
      );
      const result = runQueryEvents(
        old,
        source,
        {
          onEvent: () =>
            queryEffects.setData(["user"], "old").pipe(Effect.asVoid),
          onExit: () =>
            Effect.sync(() => {
              order.push("exit");
            }),
        },
        Effect.runPromiseExit
      );
      await entered.promise;
      const disposed = old.dispose();
      await finalizing.promise;
      expect(order).toStrictEqual([]);
      cleanup.open();
      await disposed;
      const exit = await result;
      expect(Exit.isFailure(exit)).toBe(true);
      expect(order).toStrictEqual(["cleanup", "exit", "release"]);
      expect({
        old: old.queryClient.getQueryData(["user"]),
        next: next.queryClient.getQueryData(["user"]),
      }).toStrictEqual({ old: undefined, next: "replacement" });
      await expect(
        runQueryEvents(
          old,
          Stream.succeed(1),
          { onEvent: () => Effect.void },
          Effect.runPromiseExit
        )
      ).rejects.toThrow("retired");
      await next.dispose();
    }
  );

  it.each(["refresh", "update"] as const)(
    "preserves complete %s failure and stops later cache updates",
    async (phase) => {
      const owner = await acquireQueryOwner(
        async () => await Promise.resolve(null)
      );
      const source = recoverStream({
        connect: () =>
          phase === "refresh" ? Stream.fail("expired") : Stream.make(1, 2),
        cursor: (value) => value,
        retryDelay: () => 0,
        isReplayExpired: () => true,
        onReplayExpired: () =>
          Effect.failCause(
            Cause.combine(
              Cause.fail("refresh failed"),
              Cause.die("refresh defect")
            )
          ),
      });
      const thrown = new Error("update failed");
      const exit = await runQueryEvents(
        owner,
        source,
        {
          onEvent: () =>
            queryEffects
              .setData(["user"], () => {
                throw thrown;
              })
              .pipe(Effect.asVoid),
        },
        Effect.runPromiseExit
      );
      expect(exit).toStrictEqual(
        phase === "refresh"
          ? Exit.failCause(
              Cause.combine(
                Cause.fail("refresh failed"),
                Cause.die("refresh defect")
              )
            )
          : Exit.fail(new QueryClientOperationError(thrown))
      );
      expect(owner.queryClient.getQueryData(["user"])).toBeUndefined();
      await owner.dispose();
    }
  );

  it("maps gaps and expired replay to generated native keys, invalidation and refreshed state", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* eventWorkflow() {
          const client = yield* makeRpcTestClient(directory, {
            "users.read": ({ id }) => Effect.succeed({ id, name: "server" }),
          });
          yield* Effect.promise(async () => {
            let closed = false;
            const app = await acquireDirectoryEvents(
              async () =>
                await Promise.resolve({
                  client,
                  connect: (cursor) =>
                    cursor === "0"
                      ? Stream.make(
                          { position: "1", id: 1, name: "Ada" },
                          { position: "1", id: 1, name: "duplicate" },
                          { position: "3", id: 1, name: "Grace" }
                        ).pipe(Stream.concat(Stream.fail("expired" as const)))
                      : Stream.succeed({ position: "5", id: 1, name: "final" }),
                  refresh: Effect.succeed({
                    cursor: "4",
                    users: [
                      { id: 1, name: "snapshot" },
                      { id: 2, name: "refreshed" },
                    ],
                  }),
                  close: async () => {
                    await Promise.resolve();
                    closed = true;
                  },
                })
            );
            const { owner } = app;
            const key = owner.resources.rpc.users.read.queryKey({ id: 1 });
            const values: unknown[] = [];
            const unsubscribe = owner.queryClient
              .getQueryCache()
              .subscribe(() => {
                values.push(owner.queryClient.getQueryData(key));
              });
            await app.completion;

            expect(values).toContainEqual({ id: 1, name: "snapshot" });

            expect(owner.queryClient.getQueryData(key)).toStrictEqual({
              id: 1,
              name: "final",
            });
            expect(
              owner.queryClient.getQueryData(
                owner.resources.rpc.users.read.queryKey({ id: 2 })
              )
            ).toStrictEqual({ id: 2, name: "refreshed" });
            expect(owner.queryClient.getQueryState(key)?.isInvalidated).toBe(
              true
            );

            unsubscribe();
            await owner.dispose();
            expect(closed).toBe(true);
          });
        })
      )
    );
  });

  it("awaits gap invalidation before applying the next generated update", async () => {
    const owner = await acquireQueryOwner(
      async () => await Promise.resolve(null)
    );
    const gap = gate();
    const resume = gate();
    owner.queryClient.setQueryData(["user"], "before gap");
    const source = recoverStream({
      initialCursor: 1,
      connect: () => Stream.succeed(3),
      cursor: (value) => value,
      retryDelay: () => {},
      onGap: () =>
        Effect.gen(function* gapRefresh() {
          yield* queryEffects.invalidate({
            queryKey: ["user"],
            refetchType: "none",
          });
          gap.open();
          yield* Effect.promise(async () => {
            await resume.promise;
          });
        }),
    });
    const result = runQueryEvents(
      owner,
      source,
      {
        onEvent: () =>
          queryEffects.setData(["user"], "after gap").pipe(Effect.asVoid),
      },
      Effect.runPromiseExit
    );
    await gap.promise;
    expect({
      value: owner.queryClient.getQueryData(["user"]),
      stale: owner.queryClient.getQueryState(["user"])?.isInvalidated,
    }).toStrictEqual({ value: "before gap", stale: true });
    resume.open();
    await expect(result).resolves.toStrictEqual(Exit.void);
    expect(owner.queryClient.getQueryData(["user"])).toBe("after gap");
    await owner.dispose();
  });
});
