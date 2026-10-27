import { describe, expect, it } from "@effect/vitest";
import { QueryClient } from "@tanstack/query-core";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Equal,
  Exit,
  Fiber,
  Schema,
  Stream,
} from "effect";
import type { RpcClient } from "effect/rpc";
import { Rpc, RpcGroup } from "effect/rpc";
import { TestClock } from "effect/testing";

import {
  createRpcQueryUtils,
  isEffectRpcQueryError,
  recoverStream,
} from "#effect-api-query";
import type { StreamConnectionState } from "#effect-api-query";

import { captureFailure } from "./fixtures/async";
import { makeRpcTestClient } from "./fixtures/effect-rpc";

it.effect(
  "resumes after accepted cursors, ignores replayed events, and exposes connection state",
  () =>
    Effect.gen(function* resumesAcceptedCursors() {
      const connections: number[] = [];
      const states: StreamConnectionState<string>[] = [];
      const gaps: number[][] = [];
      const values = yield* Stream.runCollect(
        recoverStream({
          connect: (cursor) => {
            connections.push(cursor);
            return connections.length === 1
              ? Stream.make(1, 2).pipe(Stream.concat(Stream.fail("offline")))
              : Stream.make(1, 2, 3, 5);
          },
          cursor: (value) => value,
          retryDelay: (_cause, attempt) => (attempt < 2 ? 0 : undefined),
          onGap: (previous, next) =>
            Effect.sync(() => {
              gaps.push([previous, next]);
            }),
          onState: (state) =>
            Effect.sync(() => {
              states.push(state);
            }),
        })
      );
      expect(values).toStrictEqual([1, 2, 3, 5]);
      expect(connections).toStrictEqual([0, 2]);
      expect(gaps).toStrictEqual([[3, 5]]);
      expect(
        states.filter((state) => state.status === "connecting")
      ).toStrictEqual([
        { status: "connecting", cursor: 0, attempt: 0 },
        { status: "connecting", cursor: 2, attempt: 1 },
      ]);
      expect(states.at(-1)).toStrictEqual({ status: "completed", cursor: 5 });
    })
);

it.effect(
  "refreshes authoritative reads after replay expiry before reconnecting at their cursor",
  () =>
    Effect.gen(function* refreshesExpiredReplay() {
      const order: string[] = [];
      const values = yield* Stream.runCollect(
        recoverStream({
          initialCursor: 4,
          connect: (cursor) => {
            order.push(`connect:${cursor}`);
            return cursor === 4
              ? Stream.fail("expired" as const)
              : Stream.succeed(11);
          },
          cursor: (value) => value,
          retryDelay: (_cause, attempt) => (attempt === 1 ? 0 : undefined),
          isReplayExpired: (cause) => Cause.hasFails(cause),
          onReplayExpired: () =>
            Effect.sync(() => {
              order.push("refresh");
              return 10;
            }),
        })
      );
      expect(order).toStrictEqual(["connect:4", "refresh", "connect:10"]);
      expect(values).toStrictEqual([11]);
    })
);

it.effect(
  "preserves the complete Cause when retries stop and counts retries across the consumption",
  () =>
    Effect.gen(function* preservesRetryFailureCause() {
      const cause = Cause.combine(
        Cause.fail("offline"),
        Cause.die(new Error("defect"))
      );
      let connections = 0;
      const exit = yield* Effect.exit(
        Stream.runDrain(
          recoverStream({
            connect: () => {
              connections += 1;
              return Stream.succeed(connections).pipe(
                Stream.concat(Stream.failCause(cause))
              );
            },
            cursor: (value) => value,
            retryDelay: (_cause, attempt) => (attempt <= 2 ? 0 : undefined),
          })
        )
      );
      expect(connections).toBe(3);
      expect(Exit.isFailure(exit) && Equal.equals(exit.cause, cause)).toBe(
        true
      );
    })
);

describe.each(["ensuring", "acquireRelease"] as const)(
  "%s recovery cleanup",
  (finalizer) => {
    describe.each(["completion", "failure"] as const)(
      "after stream %s",
      (ending) => {
        it.each(["direct", "live", "streamed"] as const)(
          "classifies and preserves complete attempt Causes through %s consumption",
          async (operation) => {
            const streamCause = Cause.combine(
              Cause.fail("offline"),
              Cause.die(new Error("source defect"))
            );
            const cleanupCause = Cause.combine(
              Cause.die(new Error("first release failed")),
              Cause.die(new Error("second release failed"))
            );
            const values =
              ending === "completion"
                ? Stream.succeed(1)
                : Stream.succeed(1).pipe(
                    Stream.concat(Stream.failCause(streamCause))
                  );
            const release = Effect.failCause(cleanupCause);
            const source =
              finalizer === "ensuring"
                ? values.pipe(Stream.ensuring(release))
                : Stream.unwrap(
                    Effect.acquireRelease(Effect.void, () => release).pipe(
                      Effect.as(values)
                    )
                  );
            const direct = await Effect.runPromiseExit(
              Stream.runCollect(source)
            );
            if (Exit.isSuccess(direct)) {
              throw new TypeError("Expected a failed client stream");
            }
            const retries: { cause: Cause.Cause<string>; attempt: number }[] =
              [];
            const states: StreamConnectionState<string>[] = [];
            const recovered = recoverStream({
              connect: () => source,
              cursor: (value) => value,
              retryDelay: (cause, attempt): undefined => {
                retries.push({ cause, attempt });
              },
              onState: (state) =>
                Effect.sync(() => {
                  states.push(state);
                }),
            });
            let terminalCause: Cause.Cause<unknown>;
            if (operation === "direct") {
              const exit = await Effect.runPromiseExit(
                Stream.runCollect(recovered)
              );
              if (Exit.isSuccess(exit)) {
                throw new TypeError("Expected stream recovery to fail");
              }
              terminalCause = exit.cause;
            } else {
              const group = RpcGroup.make(
                Rpc.make("watch", {
                  success: Schema.Int,
                  error: Schema.String,
                  stream: true,
                })
              );
              /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
              const client = (() => recovered) as RpcClient.RpcClient.Flat<
                RpcGroup.Rpcs<typeof group>
              >;
              /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
              const rpc = createRpcQueryUtils(group, {
                client,
                keyPrefix: ["recovery-cleanup", finalizer, ending, operation],
              });
              const queryClient = new QueryClient({
                defaultOptions: { queries: { retry: false } },
              });
              try {
                const error = await captureFailure(
                  operation === "live"
                    ? queryClient.query(rpc.watch.liveOptions())
                    : queryClient.query(
                        rpc.watch.streamedOptions({ maxChunks: "unbounded" })
                      )
                );
                if (!isEffectRpcQueryError(error)) {
                  throw new TypeError("Expected an RPC execution error");
                }
                terminalCause = error.cause;
              } finally {
                queryClient.clear();
              }
            }
            expect(retries).toStrictEqual([
              { cause: direct.cause, attempt: 1 },
            ]);
            expect(Equal.equals(terminalCause, direct.cause)).toBe(true);
            expect(states.at(-1)).toStrictEqual({
              status: "failed",
              cursor: 1,
              cause: direct.cause,
            });
          }
        );
      }
    );
  }
);

it.effect(
  "interrupts retry backoff without starting another connection or refresh",
  () =>
    Effect.gen(function* interruptsRecoveryBackoff() {
      const backingOff = yield* Deferred.make<boolean>();
      const states: string[] = [];
      let connections = 0;
      let refreshes = 0;
      const fiber = yield* Stream.runDrain(
        recoverStream({
          connect: () => {
            connections += 1;
            return Stream.fail("expired");
          },
          cursor: (value: number) => value,
          retryDelay: () => "1 hour",
          isReplayExpired: () => true,
          onReplayExpired: () =>
            Effect.sync(() => {
              refreshes += 1;
              return 100;
            }),
          onState: (state) =>
            Effect.gen(function* onState() {
              states.push(state.status);
              if (state.status === "backing-off") {
                yield* Deferred.succeed(backingOff, true);
              }
            }),
        })
      ).pipe(Effect.forkChild);
      yield* Deferred.await(backingOff);
      yield* Fiber.interrupt(fiber);
      yield* TestClock.adjust("2 hours");
      expect(connections).toBe(1);
      expect(refreshes).toBe(0);
      expect(states.at(-1)).toBe("stopped");
    })
);

it.effect(
  "keeps cursor state separate for repeated consumptions and stops expired replay without a refresh hook",
  () =>
    Effect.gen(function* isolatesConsumptionCursors() {
      const cursors: number[] = [];
      const source = recoverStream({
        initialCursor: 3,
        connect: (cursor) => {
          cursors.push(cursor);
          return Stream.make(3, 4);
        },
        cursor: (value) => value,
        retryDelay: (_cause, attempt) => (attempt < 1 ? 0 : undefined),
      });
      expect(yield* Stream.runCollect(source)).toStrictEqual([4]);
      expect(yield* Stream.runCollect(source)).toStrictEqual([4]);
      expect(cursors).toStrictEqual([3, 3]);
      const cause = Cause.fail("expired");
      const exit = yield* Stream.runDrain(
        recoverStream({
          connect: () => Stream.failCause(cause),
          cursor: (value: number) => value,
          retryDelay: () => 0,
          isReplayExpired: () => true,
        })
      ).pipe(Effect.exit);
      expect(Exit.isFailure(exit) && Equal.equals(exit.cause, cause)).toBe(
        true
      );
    })
);

it.effect(
  "interrupts an in-progress replay refresh before another connection starts",
  () =>
    Effect.gen(function* interruptsReplayRefresh() {
      const refreshing = yield* Deferred.make<boolean>();
      const states: string[] = [];
      let connections = 0;
      const fiber = yield* recoverStream({
        connect: () => {
          connections += 1;
          return Stream.fail("expired");
        },
        cursor: (value: number) => value,
        retryDelay: () => 0,
        isReplayExpired: () => true,
        onReplayExpired: () =>
          Deferred.succeed(refreshing, true).pipe(Effect.andThen(Effect.never)),
        onState: (state) =>
          Effect.sync(() => {
            states.push(state.status);
          }),
      }).pipe(Stream.runDrain, Effect.forkChild);
      yield* Deferred.await(refreshing);
      yield* Fiber.interrupt(fiber);
      expect(connections).toBe(1);
      expect(states.at(-1)).toBe("stopped");
    })
);

class RecoveryDependency extends Context.Service<
  RecoveryDependency,
  { readonly next: number }
>()("RecoveryDependency") {}

it.effect("uses the consumer runtime for connections and refresh hooks", () =>
  Effect.gen(function* usesConsumerRuntime() {
    const recovered = recoverStream({
      connect: () =>
        Stream.fromEffect(
          RecoveryDependency.pipe(Effect.map((service) => service.next))
        ),
      cursor: (value) => value,
      retryDelay: (_cause, attempt) => (attempt < 1 ? 0 : undefined),
    });
    expect(
      yield* recovered.pipe(
        Stream.runCollect,
        Effect.provideService(RecoveryDependency, { next: 7 })
      )
    ).toStrictEqual([7]);
  })
);

it.effect(
  "restarts an application-owned RPC feed behind one stable logical query key",
  () =>
    Effect.gen(function* reconnectsBehindStableKey() {
      const group = RpcGroup.make(
        Rpc.make("watch", {
          payload: { feed: Schema.String },
          success: Schema.Int,
          error: Schema.String,
          stream: true,
        })
      );
      const cursors: number[] = [];
      const client = yield* makeRpcTestClient(group, {
        watch: () =>
          recoverStream({
            connect: (cursor) => {
              cursors.push(cursor);
              return cursor === 0
                ? Stream.make(1, 2).pipe(Stream.concat(Stream.fail("offline")))
                : Stream.make(2, 3);
            },
            cursor: (value) => value,
            retryDelay: (_cause, attempt) => (attempt === 1 ? 0 : undefined),
          }),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["recovered-feed"],
      });
      const options = rpc.watch.streamedOptions({
        maxChunks: "unbounded",
        input: { feed: "news" },
        retry: false,
      });
      const queryClient = new QueryClient();
      try {
        expect(
          yield* Effect.promise(async () => await queryClient.query(options))
        ).toStrictEqual([1, 2, 3]);
        expect(cursors).toStrictEqual([0, 2]);
        expect(
          queryClient
            .getQueryCache()
            .getAll()
            .map((query) => query.queryKey)
        ).toStrictEqual([
          rpc.watch.streamedKey({ feed: "news" }, { maxChunks: "unbounded" }),
        ]);
      } finally {
        queryClient.clear();
      }
    })
);
