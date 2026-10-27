import { CancelledError, QueryClient } from "@tanstack/query-core";
import type { QueryKey } from "@tanstack/query-core";
import {
  Cause,
  Deferred,
  Effect,
  Equal,
  Exit,
  Layer,
  Queue,
  Schema,
  Scope,
  Stream,
} from "effect";
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { assert, expect } from "vitest";

import { createRpcQueryUtils, isEffectRpcQueryError } from "#effect-api-query";

import {
  runSocketCase,
  serveSocketGroup,
} from "../../examples/server/tests/fixtures/websocket-server.ts";
import { readSocketSnapshot } from "./docs-websocket-use.ts";
import { acquireSocketQueries } from "./socket-client.ts";

interface RetiringSocketOwner {
  queryClient: QueryClient | undefined;
}

const wait = <A>(deferred: Deferred.Deferred<A>) =>
  Deferred.await(deferred).pipe(Effect.timeout("5 seconds"));

const waitForData = async (
  queryClient: QueryClient,
  queryKey: QueryKey,
  expected: number | readonly number[]
) => {
  const published = Deferred.makeUnsafe<boolean>();
  const check = () => {
    const data = queryClient.getQueryData(queryKey);
    if (JSON.stringify(data) === JSON.stringify(expected)) {
      Effect.runSync(Deferred.succeed(published, true));
    }
  };
  const unsubscribe = queryClient.getQueryCache().subscribe(check);
  try {
    check();
    await Effect.runPromise(wait(published));
  } finally {
    unsubscribe();
  }
};

const settle = async (promise: PromiseLike<unknown>) => {
  try {
    return { status: "success", data: await promise } as const;
  } catch (error) {
    return { status: "failure", error } as const;
  }
};

export const exerciseSocketBufferCancellation = async () =>
  await runSocketCase(
    Effect.gen(function* checkSocketBufferCancellation() {
      const streamClosed = yield* Deferred.make<boolean>();
      const url = yield* serveSocketGroup({
        "values.read": ({ id }) => Effect.succeed(id * 10),
        "values.watch": () =>
          Stream.range(1, 64).pipe(
            Stream.concat(Stream.fromEffect(Effect.never)),
            Stream.ensuring(
              Deferred.succeed(streamClosed, true).pipe(Effect.asVoid)
            )
          ),
      });
      const { client, queryClient, rpc, dispose } = yield* acquireSocketQueries(
        url,
        "overflow"
      );
      const streamScope = yield* Scope.fork(yield* Effect.scope, "sequential");
      const queue = yield* client(
        "values.watch",
        { channel: "paused" },
        { asQueue: true, streamBufferSize: 1 }
      ).pipe(Scope.provide(streamScope));
      yield* Effect.gen(function* waitForSocketBuffer() {
        while (!(yield* Queue.isFull(queue))) {
          yield* Effect.yieldNow;
        }
      }).pipe(Effect.timeout("5 seconds"));
      const read = queryClient.query(
        rpc.values.read.queryOptions({ input: { id: 3 } })
      );
      yield* Scope.close(streamScope, Exit.void);
      yield* wait(streamClosed);
      const unaffectedRead = yield* Effect.promise(async () => await read).pipe(
        Effect.timeout("5 seconds")
      );
      expect(unaffectedRead).toBe(30);
      yield* dispose;
      return { unaffectedRead, streamCancelled: true };
    })
  );

export const exerciseSocketDecodeIsolation = async () =>
  await runSocketCase(
    Effect.gen(function* checkSocketDecodeIsolation() {
      const readStarted = yield* Deferred.make<boolean>();
      const releaseRead = yield* Deferred.make<boolean>();
      const streamsClosed = yield* Deferred.make<boolean>();
      let closed = 0;
      const url = yield* serveSocketGroup({
        "values.read": Effect.fnUntraced(function* readAfterDecodeFailure({
          id,
        }) {
          yield* Deferred.succeed(readStarted, true);
          yield* Deferred.await(releaseRead);
          return id * 10;
        }),
        "values.watch": () =>
          Stream.succeed(-1).pipe(
            Stream.concat(Stream.fromEffect(Effect.never)),
            Stream.ensuring(
              Effect.suspend(() => {
                closed += 1;
                return closed === 2
                  ? Deferred.succeed(streamsClosed, true)
                  : Effect.void;
              })
            )
          ),
      });
      const strictGroup = RpcGroup.make(
        Rpc.make("values.read", {
          payload: { id: Schema.Int },
          success: Schema.Int,
        }),
        Rpc.make("values.watch", {
          payload: { channel: Schema.String },
          success: Schema.Int.check(Schema.isGreaterThan(0)),
          stream: true,
        })
      );
      const clientScope = yield* Scope.fork(yield* Effect.scope, "sequential");
      const protocol = yield* Layer.buildWithScope(
        RpcClient.layerProtocolSocket().pipe(
          Layer.provide(RpcSerialization.layerJson),
          Layer.provide(Socket.layerWebSocket(url))
        ),
        clientScope
      );
      const client = yield* RpcClient.make(strictGroup, { flatten: true }).pipe(
        Effect.provide(protocol),
        Scope.provide(clientScope)
      );
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      yield* Scope.addFinalizer(
        clientScope,
        Effect.promise(async () => {
          await queryClient.cancelQueries();
          queryClient.clear();
        })
      );
      const rpc = createRpcQueryUtils(strictGroup, {
        client,
        keyPrefix: ["socket", "decode"],
      });
      const readOptions = rpc.values.read.queryOptions({ input: { id: 3 } });
      const read = settle(queryClient.query(readOptions));
      yield* wait(readStarted);
      for (const view of ["streamed", "live"] as const) {
        const result = yield* Effect.promise(async () =>
          view === "streamed"
            ? await settle(
                queryClient.query(
                  rpc.values.watch.streamedOptions({
                    maxChunks: "unbounded",
                    input: { channel: view },
                  })
                )
              )
            : await settle(
                queryClient.query(
                  rpc.values.watch.liveOptions({ input: { channel: view } })
                )
              )
        );
        expect(result.status).toBe("failure");
        if (result.status === "failure") {
          assert(isEffectRpcQueryError(result.error));
          expect(result.error.rpcTag).toBe("values.watch");
          expect(result.error.operation).toBe(view);
          expect(Cause.hasDies(result.error.cause)).toBe(true);
        }
        expect(
          queryClient.getQueryState(readOptions.queryKey)?.fetchStatus
        ).toBe("fetching");
      }
      yield* wait(streamsClosed);
      yield* Deferred.succeed(releaseRead, true);
      const readResult = yield* Effect.promise(async () => await read);
      expect(readResult.status).toBe("success");
      if (readResult.status === "success") {
        expect(readResult.data).toBe(30);
      }
      yield* Scope.close(clientScope, Exit.void);
      return { rejectedStreams: closed, unaffectedRead: 30 };
    })
  );

export const exerciseSocketConcurrency = async () =>
  await runSocketCase(
    Effect.gen(function* checkSocketConcurrency() {
      const readsStarted = yield* Deferred.make<boolean>();
      const releaseReads = yield* Deferred.make<boolean>();
      const releaseSecond = yield* Deferred.make<boolean>();
      const historyClosed = yield* Deferred.make<boolean>();
      const liveClosed = yield* Deferred.make<boolean>();
      let started = 0;
      const url = yield* serveSocketGroup({
        "values.read": Effect.fnUntraced(function* readConcurrentRequests({
          id,
        }) {
          started += 1;
          if (started === 2) {
            yield* Deferred.succeed(readsStarted, true);
          }
          yield* Deferred.await(releaseReads);
          return id * 10;
        }),
        "values.watch": ({ channel }) =>
          Stream.succeed(1).pipe(
            Stream.concat(
              channel === "clock"
                ? Stream.empty
                : Stream.fromEffect(
                    Deferred.await(releaseSecond).pipe(Effect.as(2))
                  )
            ),
            Stream.concat(Stream.fromEffect(Effect.never)),
            Stream.ensuring(
              Deferred.succeed(
                channel === "history" ? historyClosed : liveClosed,
                true
              ).pipe(Effect.asVoid)
            )
          ),
      });
      const { queryClient, rpc, dispose } = yield* acquireSocketQueries(
        url,
        "first"
      );
      const reads = [1, 2].map(
        async (id) =>
          await queryClient.query(
            rpc.values.read.queryOptions({ input: { id } })
          )
      );
      const historyOptions = rpc.values.watch.streamedOptions({
        maxChunks: "unbounded",
        input: { channel: "history" },
        rpcOptions: { streamBufferSize: 16 },
      });
      const liveOptions = rpc.values.watch.liveOptions({
        input: { channel: "live" },
        rpcOptions: { streamBufferSize: 16 },
      });
      const history = settle(queryClient.query(historyOptions));
      const live = settle(queryClient.query(liveOptions));
      yield* wait(readsStarted);
      yield* Effect.promise(async () => {
        await waitForData(queryClient, historyOptions.queryKey, [1]);
      });
      yield* Effect.promise(async () => {
        await waitForData(queryClient, liveOptions.queryKey, 1);
      });
      expect(queryClient.getQueryState(historyOptions.queryKey)?.status).toBe(
        "success"
      );
      expect(
        queryClient.getQueryState(historyOptions.queryKey)?.fetchStatus
      ).toBe("fetching");
      expect(queryClient.getQueryState(liveOptions.queryKey)?.status).toBe(
        "success"
      );
      expect(queryClient.getQueryState(liveOptions.queryKey)?.fetchStatus).toBe(
        "fetching"
      );
      expect(yield* Deferred.isDone(historyClosed)).toBe(false);
      expect(yield* Deferred.isDone(liveClosed)).toBe(false);
      yield* Effect.promise(async () => {
        await queryClient.cancelQueries({
          queryKey: historyOptions.queryKey,
          exact: true,
        });
      });
      yield* wait(historyClosed);
      const historyResult = yield* Effect.promise(async () => await history);
      expect(historyResult.status).toBe("success");
      if (historyResult.status === "success") {
        expect(historyResult.data).toStrictEqual([1]);
      }
      expect(yield* Deferred.isDone(liveClosed)).toBe(false);
      expect(queryClient.getQueryState(liveOptions.queryKey)?.fetchStatus).toBe(
        "fetching"
      );
      yield* Deferred.succeed(releaseSecond, true);
      yield* Effect.promise(async () => {
        await waitForData(queryClient, liveOptions.queryKey, 2);
      });
      yield* Deferred.succeed(releaseReads, true);
      const values = yield* Effect.promise(
        async () => await Promise.all(reads)
      );
      expect(values).toStrictEqual([10, 20]);
      yield* Effect.promise(async () => {
        await queryClient.cancelQueries({
          queryKey: liveOptions.queryKey,
          exact: true,
        });
      });
      yield* wait(liveClosed);
      const liveResult = yield* Effect.promise(async () => await live);
      expect(liveResult.status).toBe("success");
      if (liveResult.status === "success") {
        expect(liveResult.data).toBe(2);
      }
      expect(yield* readSocketSnapshot(url)).toStrictEqual({
        reads: [10, 20],
        history: [1],
        latest: 1,
      });
      yield* dispose;
      expect(queryClient.isFetching()).toBe(0);
      expect(queryClient.getQueryCache().getAll().length).toBe(0);
      return {
        reads: values,
        history: [1],
        latest: 1,
        historyCancelled: true,
        liveContinued: 2,
        liveCancelled: true,
      };
    })
  );

export const exerciseSocketInterruption = async () =>
  await runSocketCase(
    Effect.gen(function* checkSocketInterruption() {
      const readStarted = yield* Deferred.make<boolean>();
      const releaseRead = yield* Deferred.make<boolean>();
      const url = yield* serveSocketGroup({
        "values.read": Effect.fnUntraced(function* readBeforeInterruption({
          id,
        }) {
          if (id < 0) {
            return yield* Effect.failCause(Cause.interrupt(42));
          }
          yield* Deferred.succeed(readStarted, true);
          yield* Deferred.await(releaseRead);
          return id * 10;
        }),
        "values.watch": ({ channel }) => {
          const interruption = Stream.failCause(Cause.interrupt(42));
          return channel.endsWith("emitted")
            ? Stream.succeed(7).pipe(Stream.concat(interruption))
            : interruption;
        },
      });
      const { client, rpc, queryClient, dispose } = yield* acquireSocketQueries(
        url,
        "interrupted"
      );
      const unaffected = queryClient.query(
        rpc.values.read.queryOptions({ input: { id: 3 } })
      );
      yield* wait(readStarted);
      const nativeUnary = yield* client("values.read", { id: -1 }).pipe(
        Effect.exit
      );
      const generatedUnary = yield* Effect.promise(
        async () =>
          await settle(
            queryClient.query(
              rpc.values.read.queryOptions({ input: { id: -1 } })
            )
          )
      );
      assert(Exit.isFailure(nativeUnary));
      expect(generatedUnary.status).toBe("failure");
      if (generatedUnary.status === "failure") {
        assert(isEffectRpcQueryError(generatedUnary.error));
        expect(generatedUnary.error.operation).toBe("query");
        expect(
          Equal.equals(nativeUnary.cause, generatedUnary.error.cause)
        ).toBe(true);
        expect(Cause.hasInterruptsOnly(generatedUnary.error.cause)).toBe(true);
      }
      for (const view of ["streamed", "live"] as const) {
        for (const emitted of [false, true]) {
          const input = { channel: `${view}-${emitted ? "emitted" : "empty"}` };
          const nativeStream = yield* client("values.watch", input, {
            streamBufferSize: 16,
          }).pipe(Stream.runCollect, Effect.exit);
          const options =
            view === "streamed"
              ? rpc.values.watch.streamedOptions({
                  maxChunks: "unbounded",
                  input,
                  rpcOptions: { streamBufferSize: 16 },
                })
              : rpc.values.watch.liveOptions({
                  input,
                  rpcOptions: { streamBufferSize: 16 },
                });
          const generatedStream = yield* Effect.promise(
            async () =>
              await settle(
                view === "streamed"
                  ? queryClient.query(
                      rpc.values.watch.streamedOptions({
                        maxChunks: "unbounded",
                        input,
                        rpcOptions: { streamBufferSize: 16 },
                      })
                    )
                  : queryClient.query(
                      rpc.values.watch.liveOptions({
                        input,
                        rpcOptions: { streamBufferSize: 16 },
                      })
                    )
              )
          );
          assert(Exit.isFailure(nativeStream));
          expect(generatedStream.status).toBe("failure");
          if (generatedStream.status === "failure") {
            assert(isEffectRpcQueryError(generatedStream.error));
            expect(generatedStream.error.rpcTag).toBe("values.watch");
            expect(generatedStream.error.operation).toBe(view);
            expect(
              Equal.equals(nativeStream.cause, generatedStream.error.cause)
            ).toBe(true);
            expect(Cause.hasInterruptsOnly(generatedStream.error.cause)).toBe(
              true
            );
            expect(queryClient.getQueryState(options.queryKey)?.error).toBe(
              generatedStream.error
            );
            expect(queryClient.getQueryState(options.queryKey)?.status).toBe(
              "error"
            );
          }
          const emittedData = view === "streamed" ? [7] : 7;
          expect(queryClient.getQueryData(options.queryKey)).toStrictEqual(
            emitted ? emittedData : undefined
          );
          expect(
            queryClient.getQueryState(rpc.values.read.queryKey({ id: 3 }))
              ?.fetchStatus
          ).toBe("fetching");
        }
      }
      yield* Deferred.succeed(releaseRead, true);
      const unaffectedRead = yield* Effect.promise(
        async () => await unaffected
      );
      expect(unaffectedRead).toBe(30);
      yield* dispose;
      return { comparedWireCauses: 5, unaffectedRead };
    })
  );

export const exerciseSocketReplacement = async () =>
  await runSocketCase(
    Effect.gen(function* checkSocketReplacement() {
      const oldClosed = yield* Deferred.make<boolean>();
      const unrelatedClosed = yield* Deferred.make<boolean>();
      const replacementClosed = yield* Deferred.make<boolean>();
      const releaseSecond = yield* Deferred.make<boolean>();
      const readStarted = yield* Deferred.make<boolean>();
      const disconnected = yield* Deferred.make<boolean>();
      const ownerFinalizers = [oldClosed, replacementClosed];
      const url = yield* serveSocketGroup({
        "values.read": () =>
          Deferred.succeed(readStarted, true).pipe(
            Effect.andThen(Effect.never)
          ),
        "values.watch": ({ channel }) => {
          const finalized =
            channel === "owner-a" ? ownerFinalizers.shift() : unrelatedClosed;
          if (finalized === undefined) {
            return Stream.die(new Error("Unexpected owner acquisition"));
          }
          return Stream.succeed(1).pipe(
            Stream.concat(
              Stream.fromEffect(
                Deferred.await(releaseSecond).pipe(Effect.as(2))
              )
            ),
            Stream.concat(Stream.fromEffect(Effect.never)),
            Stream.ensuring(
              Deferred.succeed(finalized, true).pipe(Effect.asVoid)
            )
          );
        },
      });
      const retiringOwner: RetiringSocketOwner = { queryClient: undefined };
      const oldOwner = yield* acquireSocketQueries(url, "a").pipe(
        Effect.provideService(RpcClient.ConnectionHooks, {
          onConnect: Effect.void,
          onDisconnect: Effect.gen(function* onDisconnect() {
            expect(retiringOwner.queryClient?.isFetching()).toBe(0);
            expect(
              retiringOwner.queryClient?.getQueryCache().getAll().length
            ).toBe(0);
            yield* Deferred.succeed(disconnected, true);
          }),
        })
      );
      retiringOwner.queryClient = oldOwner.queryClient;
      const unrelatedOwner = yield* acquireSocketQueries(url, "b");
      const oldOptions = oldOwner.rpc.values.watch.liveOptions({
        input: { channel: "owner-a" },
      });
      const unrelatedOptions = unrelatedOwner.rpc.values.watch.liveOptions({
        input: { channel: "owner-b" },
      });
      const oldRead = settle(
        oldOwner.queryClient.query(
          oldOwner.rpc.values.read.queryOptions({ input: { id: 1 } })
        )
      );
      const oldStream = settle(oldOwner.queryClient.query(oldOptions));
      const unrelatedStream = settle(
        unrelatedOwner.queryClient.query(unrelatedOptions)
      );
      yield* wait(readStarted);
      yield* Effect.promise(async () => {
        await waitForData(oldOwner.queryClient, oldOptions.queryKey, 1);
      });
      yield* Effect.promise(async () => {
        await waitForData(
          unrelatedOwner.queryClient,
          unrelatedOptions.queryKey,
          1
        );
      });
      yield* oldOwner.dispose;
      yield* wait(disconnected);
      yield* wait(oldClosed);
      const cancelledRead = yield* Effect.promise(async () => await oldRead);
      expect(cancelledRead.status).toBe("failure");
      if (cancelledRead.status === "failure") {
        expect(cancelledRead.error instanceof CancelledError).toBe(true);
      }
      yield* Effect.promise(async () => await oldStream);
      expect(yield* Deferred.isDone(unrelatedClosed)).toBe(false);
      expect(
        unrelatedOwner.queryClient.getQueryState(unrelatedOptions.queryKey)
          ?.fetchStatus
      ).toBe("fetching");
      const replacement = yield* acquireSocketQueries(url, "a");
      const replacementOptions = replacement.rpc.values.watch.liveOptions({
        input: { channel: "owner-a" },
      });
      expect(replacementOptions.queryKey).toStrictEqual(oldOptions.queryKey);
      expect(replacement.queryClient === oldOwner.queryClient).toBe(false);
      const replacementStream = settle(
        replacement.queryClient.query(replacementOptions)
      );
      yield* Effect.promise(async () => {
        await waitForData(
          replacement.queryClient,
          replacementOptions.queryKey,
          1
        );
      });
      yield* Deferred.succeed(releaseSecond, true);
      yield* Effect.promise(async () => {
        await waitForData(
          unrelatedOwner.queryClient,
          unrelatedOptions.queryKey,
          2
        );
      });
      yield* Effect.promise(async () => {
        await waitForData(
          replacement.queryClient,
          replacementOptions.queryKey,
          2
        );
      });
      expect(oldOwner.queryClient.getQueryCache().getAll().length).toBe(0);
      yield* unrelatedOwner.dispose;
      yield* replacement.dispose;
      yield* wait(unrelatedClosed);
      yield* wait(replacementClosed);
      yield* Effect.promise(
        async () => await Promise.all([unrelatedStream, replacementStream])
      );
      return {
        oldOwnerCancelled: true,
        unrelatedOwnerContinued: 2,
        replacementValue: 1,
        disconnectsAfterQueryCancellation: true,
      };
    })
  );
