import { describe, expect, it } from "@effect/vitest";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Queue,
  Schema,
  Stream,
} from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { TestClock } from "effect/testing";

import { createRpcQueryUtils } from "#effect-api-query";

import {
  streamLiveSnapshots,
  streamPublicationBatches,
} from "../src/core/stream-publication";
import { makeRpcTestClient } from "./fixtures/effect-rpc";

describe("publication deadlines with TestClock", () => {
  it.effect(
    "publishes the first value immediately and flushes subsequent batches at non-sliding deadlines",
    () =>
      Effect.gen(function* flushesReadyBatchesAtDeadline() {
        const source = Stream.fromIterable([1, 2, 3, 4]).pipe(
          Stream.rechunk(1),
          Stream.mapEffect((value) => Effect.sleep(30).pipe(Effect.as(value)))
        );
        const fiber = yield* Stream.runCollect(
          streamPublicationBatches(source, 10, 50)
        ).pipe(Effect.forkChild);

        yield* TestClock.adjust(30);
        yield* TestClock.adjust(30);
        yield* TestClock.adjust(30);
        yield* TestClock.adjust(20);
        yield* TestClock.adjust(10);

        const batches = yield* Fiber.join(fiber);
        expect(batches).toStrictEqual([[1], [2, 3], [4]]);
      })
  );

  it.effect(
    "flushes quiet batches on a deadline without starting concurrent pulls",
    () =>
      Effect.gen(function* flushesQuietBatchesWithoutConcurrentPulls() {
        const queue = yield* Queue.unbounded<number>();
        let pulls = 0;
        let closed = 0;
        const source = Stream.fromPull(
          Effect.succeed(
            Effect.gen(function* pullOne() {
              pulls += 1;
              const value = yield* Queue.take(queue);
              return [value] as const;
            })
          )
        ).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              closed += 1;
            })
          )
        );

        const pull = yield* Stream.toPull(
          streamPublicationBatches(source, 10, 50)
        );

        const firstFiber = yield* Effect.forkChild(pull);
        yield* Queue.offer(queue, 1);
        expect(yield* Fiber.join(firstFiber)).toStrictEqual([[1]]);

        const secondFiber = yield* Effect.forkChild(pull);
        yield* Queue.offer(queue, 2);
        yield* TestClock.adjust(49);
        const pullsBeforeDeadline = pulls;
        expect(secondFiber.pollUnsafe()).toBeUndefined();

        yield* TestClock.adjust(1);
        expect(yield* Fiber.join(secondFiber)).toStrictEqual([[2]]);

        const thirdFiber = yield* Effect.forkChild(pull);
        yield* TestClock.adjust(0);
        const pullsAfterDeadline = pulls;
        yield* Queue.offer(queue, 3);
        yield* TestClock.adjust(50);
        expect(yield* Fiber.join(thirdFiber)).toStrictEqual([[3]]);

        expect({
          pullsBeforeDeadline,
          pullsAfterDeadline,
          closed,
        }).toStrictEqual({
          pullsBeforeDeadline: 3,
          pullsAfterDeadline: 3,
          closed: 0,
        });
      })
  );

  it.effect(
    "coalesces live snapshots to the latest value at a non-sliding TestClock deadline",
    () =>
      Effect.gen(function* coalescesLiveSnapshotsWithTestClock() {
        const queue = yield* Queue.unbounded<number>();
        const source = Stream.fromPull(
          Effect.succeed(
            Queue.take(queue).pipe(Effect.map((value) => [value] as const))
          )
        );
        const pull = yield* Stream.toPull(
          streamLiveSnapshots(source, 20, undefined)
        );

        const firstFiber = yield* Effect.forkChild(pull);
        yield* Queue.offer(queue, 1);
        expect(yield* Fiber.join(firstFiber)).toStrictEqual([1]);

        const secondFiber = yield* Effect.forkChild(pull);
        yield* Queue.offer(queue, 2);
        yield* TestClock.adjust(19);
        expect(secondFiber.pollUnsafe()).toBeUndefined();

        yield* Queue.offer(queue, 3);
        yield* TestClock.adjust(1);
        expect(yield* Fiber.join(secondFiber)).toStrictEqual([3]);

        const thirdFiber = yield* Effect.forkChild(pull);
        yield* Queue.offer(queue, 4);
        yield* TestClock.adjust(20);
        expect(yield* Fiber.join(thirdFiber)).toStrictEqual([4]);
      })
  );

  it.effect(
    "flushes pending buffered values before propagating a stream failure",
    () =>
      Effect.gen(function* flushesPendingBeforeFailure() {
        const failure = new Error("stream exploded");
        const source = Stream.make(1, 2, 3).pipe(
          Stream.concat(Stream.die(failure))
        );
        const pull = yield* Stream.toPull(
          streamPublicationBatches(source, 10, 50)
        );

        expect(yield* pull).toStrictEqual([[1]]);
        expect(yield* pull).toStrictEqual([[2, 3]]);
        const exit = yield* Effect.exit(pull);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toBe(failure);
        }
      })
  );

  it.effect(
    "surfaces the empty-stream error only when a live stream completes empty",
    () =>
      Effect.gen(function* surfacesEmptyLiveStreamError() {
        const emptyError = new Error("empty live stream");
        const coalescedExit = yield* Effect.exit(
          Stream.runCollect(
            streamLiveSnapshots(Stream.empty, 20, () => emptyError)
          )
        );
        expect(Exit.isFailure(coalescedExit)).toBe(true);
        if (Exit.isFailure(coalescedExit)) {
          expect(Cause.squash(coalescedExit.cause)).toBe(emptyError);
        }

        const uncoalescedExit = yield* Effect.exit(
          Stream.runCollect(
            streamLiveSnapshots(Stream.empty, undefined, () => emptyError)
          )
        );
        expect(Exit.isFailure(uncoalescedExit)).toBe(true);
        if (Exit.isFailure(uncoalescedExit)) {
          expect(Cause.squash(uncoalescedExit.cause)).toBe(emptyError);
        }

        const interruptedFiber = yield* Stream.runCollect(
          streamLiveSnapshots(Stream.never, 20, () => emptyError)
        ).pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        yield* Fiber.interrupt(interruptedFiber);
        const interruptedExit = yield* Fiber.await(interruptedFiber);
        expect(Exit.isFailure(interruptedExit)).toBe(true);
        if (Exit.isFailure(interruptedExit)) {
          expect(Cause.hasInterruptsOnly(interruptedExit.cause)).toBe(true);
        }
      })
  );

  it.effect(
    "clears an active deadline when a batch fills by count and starts a fresh window for the next batch",
    () =>
      Effect.gen(function* clearsDeadlineOnCountFlush() {
        const queue = yield* Queue.unbounded<number>();
        const source = Stream.fromPull(
          Effect.succeed(
            Queue.take(queue).pipe(Effect.map((value) => [value] as const))
          )
        );
        const pull = yield* Stream.toPull(
          streamPublicationBatches(source, 2, 50)
        );

        const firstFiber = yield* Effect.forkChild(pull);
        yield* Queue.offer(queue, 1);
        expect(yield* Fiber.join(firstFiber)).toStrictEqual([[1]]);

        const secondFiber = yield* Effect.forkChild(pull);
        yield* Queue.offer(queue, 2);
        yield* TestClock.adjust(30);
        expect(secondFiber.pollUnsafe()).toBeUndefined();

        yield* Queue.offer(queue, 3);
        expect(yield* Fiber.join(secondFiber)).toStrictEqual([[2, 3]]);

        const thirdFiber = yield* Effect.forkChild(pull);
        yield* Queue.offer(queue, 4);
        yield* TestClock.adjust(49);
        expect(thirdFiber.pollUnsafe()).toBeUndefined();

        yield* TestClock.adjust(1);
        expect(yield* Fiber.join(thirdFiber)).toStrictEqual([[4]]);
      })
  );

  it.effect(
    "does not flush buffered values when upstream terminates with an interrupt-only cause",
    () =>
      Effect.gen(function* skipsPendingBatchOnUpstreamInterrupt() {
        const emitted: (readonly number[])[] = [];
        const source = Stream.make(1, 2).pipe(
          Stream.concat(Stream.fromEffect(Effect.interrupt))
        );
        const exit = yield* Effect.exit(
          streamPublicationBatches(source, 5, 50).pipe(
            Stream.runForEach((batch) =>
              Effect.sync(() => {
                emitted.push(batch);
              })
            )
          )
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
        }
        expect(emitted).toStrictEqual([[1]]);
      })
  );

  it.effect(
    "drives live query coalescing deterministically through QueryClient with TestClock",
    () =>
      Effect.gen(function* drivesLiveQueryWithTestClock() {
        const group = RpcGroup.make(
          Rpc.make("watch", { success: Schema.Int, stream: true })
        );
        const queue = yield* Queue.unbounded<number>();
        const finalized = yield* Deferred.make<boolean>();
        const client = yield* makeRpcTestClient(group, {
          watch: () =>
            Stream.fromPull(
              Effect.succeed(
                Queue.take(queue).pipe(Effect.map((value) => [value] as const))
              )
            ).pipe(Stream.ensuring(Deferred.succeed(finalized, true))),
        });
        const runPromiseExit = Effect.runPromiseExitWith(
          yield* Effect.context()
        );
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["test-clock-live"],
          runtime: runPromiseExit,
        });
        const options = rpc.watch.liveOptions({ coalesceMs: 20 });
        const queryClient = new QueryClient();
        const observer = new QueryObserver(queryClient, options);
        const stop = observer.subscribe(() => {});
        try {
          yield* Queue.offer(queue, 1);
          yield* TestClock.adjust(0);
          expect(queryClient.getQueryData(options.queryKey)).toBe(1);

          yield* Queue.offer(queue, 2);
          yield* TestClock.adjust(19);
          expect(queryClient.getQueryData(options.queryKey)).toBe(1);

          yield* Queue.offer(queue, 3);
          yield* TestClock.adjust(1);
          expect(queryClient.getQueryData(options.queryKey)).toBe(3);

          yield* Queue.offer(queue, 4);
          yield* TestClock.adjust(10);
          yield* Effect.promise(async () => {
            await queryClient.cancelQueries(
              { queryKey: options.queryKey },
              { revert: false }
            );
          });
          yield* Deferred.await(finalized);
          yield* TestClock.adjust(50);
          expect(queryClient.getQueryData(options.queryKey)).toBe(3);
        } finally {
          stop();
          queryClient.clear();
        }
      })
  );

  it.effect(
    "drives streamed query publication deadlines deterministically through QueryClient with TestClock",
    () =>
      Effect.gen(function* drivesQueryClientWithTestClock() {
        const group = RpcGroup.make(
          Rpc.make("watch", { success: Schema.Int, stream: true })
        );
        const waiting = yield* Deferred.make<boolean>();
        const finalized = yield* Deferred.make<boolean>();
        const client = yield* makeRpcTestClient(group, {
          watch: () =>
            Stream.make(1, 2).pipe(
              Stream.concat(
                Stream.fromEffect(
                  Deferred.succeed(waiting, true).pipe(
                    Effect.andThen(Effect.never)
                  )
                )
              ),
              Stream.ensuring(Deferred.succeed(finalized, true))
            ),
        });
        const runPromiseExit = Effect.runPromiseExitWith(
          yield* Effect.context()
        );
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["test-clock-deadline"],
          runtime: runPromiseExit,
        });
        const options = rpc.watch.streamedOptions({
          maxChunks: "unbounded",
          publicationBatchSize: 10,
          publicationMaxWaitMs: 50,
        });
        const queryClient = new QueryClient();
        const observer = new QueryObserver(queryClient, options);
        const stop = observer.subscribe(() => {});
        try {
          yield* Deferred.await(waiting);
          yield* TestClock.adjust(49);
          expect(queryClient.getQueryData(options.queryKey)).toStrictEqual([1]);

          yield* TestClock.adjust(1);
          expect(queryClient.getQueryData(options.queryKey)).toStrictEqual([
            1, 2,
          ]);

          yield* Effect.promise(async () => {
            await queryClient.cancelQueries(
              { queryKey: options.queryKey },
              { revert: false }
            );
          });
          yield* Deferred.await(finalized);
        } finally {
          stop();
          queryClient.clear();
        }
      })
  );
});
