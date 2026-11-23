import { it, expect } from "@effect/vitest";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { Deferred, Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { TestClock } from "effect/testing";

import { createRpcQueryUtils } from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc";
import { waitForQueryState } from "./fixtures/query-cache";

it.effect(
  "flushes the latest pending snapshot at a fixed deadline and preserves slower snapshots",
  () =>
    Effect.gen(function* flushesDeadline() {
      const midReached = yield* Deferred.make<boolean>();
      const midResume = yield* Deferred.make<boolean>();
      const reached = yield* Deferred.make<boolean>();
      const resume = yield* Deferred.make<boolean>();
      const finalPull = yield* Deferred.make<boolean>();
      const finalized = yield* Deferred.make<boolean>();
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      const client = yield* makeRpcTestClient(group, {
        watch: () =>
          Stream.make(1, 2).pipe(
            Stream.concat(
              Stream.fromEffect(
                Deferred.succeed(midReached, true).pipe(
                  Effect.andThen(Deferred.await(midResume)),
                  Effect.as(3)
                )
              )
            ),
            Stream.concat(
              Stream.fromEffect(
                Deferred.succeed(reached, true).pipe(
                  Effect.andThen(Deferred.await(resume)),
                  Effect.as(4)
                )
              )
            ),
            Stream.concat(
              Stream.fromEffect(
                Deferred.succeed(finalPull, true).pipe(
                  Effect.andThen(Effect.never)
                )
              )
            ),
            Stream.ensuring(Deferred.succeed(finalized, true))
          ),
      });
      const runtime = Effect.runPromiseExitWith(yield* Effect.context());
      const leaf = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["deadline-live"],
        runtime,
      }).watch;
      const options = leaf.liveOptions({ coalesceMs: 20 });
      const queryClient = new QueryClient();
      const observer = new QueryObserver(queryClient, options);
      const values: unknown[] = [];
      const stopCache = queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.action.type === "success" &&
          event.action.manual === true
        ) {
          values.push(event.query.state.data);
        }
      });
      const stop = observer.subscribe(() => {});
      try {
        yield* Deferred.await(midReached);
        yield* TestClock.adjust(0);
        expect(values).toStrictEqual([1]);
        yield* TestClock.adjust(19);
        expect(values).toStrictEqual([1]);
        yield* Deferred.succeed(midResume, true);
        yield* Deferred.await(reached);
        yield* TestClock.adjust(1);
        expect(values).toStrictEqual([1, 3]);
        yield* Deferred.succeed(resume, true);
        yield* Deferred.await(finalPull);
        yield* TestClock.adjust(20);
        expect(values).toStrictEqual([1, 3, 4]);
        yield* Effect.promise(async () => {
          await queryClient.cancelQueries(
            { queryKey: options.queryKey },
            { revert: false }
          );
        });
        yield* Deferred.await(finalized);
        yield* TestClock.adjust(100);
        expect(values).toStrictEqual([1, 3, 4]);
      } finally {
        stop();
        stopCache();
        queryClient.clear();
      }
    })
);

it.effect("drops a pending snapshot and closes its source when cancelled", () =>
  Effect.gen(function* cancelsPendingSnapshot() {
    const pending = yield* Deferred.make<boolean>();
    const finalized = yield* Deferred.make<boolean>();
    const group = RpcGroup.make(
      Rpc.make("watch", { success: Schema.Int, stream: true })
    );
    const client = yield* makeRpcTestClient(group, {
      watch: () =>
        Stream.make(1, 2).pipe(
          Stream.concat(
            Stream.fromEffect(
              Deferred.succeed(pending, true).pipe(Effect.andThen(Effect.never))
            )
          ),
          Stream.ensuring(Deferred.succeed(finalized, true))
        ),
    });
    const leaf = createRpcQueryUtils(group, {
      client,
      keyPrefix: ["cancel-live"],
    }).watch;
    const options = leaf.liveOptions({ coalesceMs: 100 });
    const queryClient = new QueryClient();
    const observer = new QueryObserver(queryClient, options);
    const stop = observer.subscribe(() => {});
    try {
      yield* Deferred.await(pending);
      yield* waitForQueryState(
        queryClient,
        () => queryClient.getQueryData(options.queryKey) === 1
      );
      expect(queryClient.getQueryData(options.queryKey)).toBe(1);
      yield* Effect.promise(async () => {
        await queryClient.cancelQueries(
          { queryKey: options.queryKey },
          { revert: false }
        );
      });
      yield* Deferred.await(finalized);
      expect(queryClient.getQueryData(options.queryKey)).toBe(1);
    } finally {
      stop();
      queryClient.clear();
    }
  })
);

for (const ending of ["complete", "error", "cleanup", "empty"] as const) {
  it.effect(
    `preserves ${ending} semantics and starts fresh on every live refetch`,
    () =>
      Effect.gen(function* preservesTerminalSemantics() {
        const group = RpcGroup.make(
          Rpc.make("watch", { success: Schema.Unknown, stream: true })
        );
        let attempt = 0;
        const client = yield* makeRpcTestClient(group, {
          watch: () => {
            attempt += 1;
            const values = Stream.fromIterable<unknown>([
              attempt,
              2,
              undefined,
            ]);
            switch (ending) {
              case "empty": {
                return Stream.empty;
              }
              case "error": {
                return values.pipe(Stream.concat(Stream.die("source failed")));
              }
              case "cleanup": {
                return values.pipe(
                  Stream.ensuring(Effect.die("cleanup failed"))
                );
              }
              case "complete": {
                return values;
              }
              default: {
                throw new Error("Unknown terminal case");
              }
            }
          },
        });
        const leaf = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["terminal", ending],
        }).watch;
        const queryClient = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        const options = leaf.liveOptions({ coalesceMs: 100 });
        const writes: unknown[] = [];
        const stop = queryClient.getQueryCache().subscribe((event) => {
          if (
            event.type === "updated" &&
            event.action.type === "success" &&
            event.action.manual === true
          ) {
            writes.push(event.query.state.data);
          }
        });
        try {
          for (const expectedFirst of [1, 2]) {
            const result = yield* Effect.promise(async () => {
              try {
                return await queryClient.query(options);
              } catch (error) {
                return error;
              }
            });
            if (ending === "complete") {
              expect(result).toBeNull();
            } else {
              expect(result).toMatchObject({
                _tag:
                  ending === "empty"
                    ? "EffectRpcQueryEmptyStreamError"
                    : "EffectRpcQueryError",
              });
            }
            if (ending === "empty") {
              expect(
                queryClient.getQueryData(options.queryKey)
              ).toBeUndefined();
            } else {
              expect(writes.splice(0)).toStrictEqual([expectedFirst, null]);
              expect(queryClient.getQueryData(options.queryKey)).toBeNull();
            }
          }
        } finally {
          stop();
          queryClient.clear();
        }
      })
  );
}

it.effect(
  "rejects invalid live deadlines consistently in keys and options",
  () =>
    Effect.gen(function* validatesDeadline() {
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      const client = yield* makeRpcTestClient(group, {
        watch: () => Stream.empty,
      });
      const leaf = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["invalid-live"],
      }).watch;
      for (const coalesceMs of [
        0,
        -1,
        1.5,
        Infinity,
        Number.NaN,
        2_147_483_648,
      ]) {
        expect(() => leaf.liveKey({ coalesceMs })).toThrow("coalesceMs");
        expect(() => leaf.liveOptions({ coalesceMs })).toThrow(RangeError);
      }
      expect(leaf.liveKey({ coalesceMs: undefined })).toStrictEqual(
        leaf.liveKey()
      );
    })
);
