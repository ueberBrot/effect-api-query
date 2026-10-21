import { it } from "@effect/vitest";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { Cause, Deferred, Effect, Equal, Exit, Schema, Stream } from "effect";
import type { RpcClient } from "effect/rpc";
import { Rpc, RpcGroup } from "effect/rpc";
import { describe, expect, it as test, vi } from "vite-plus/test";

import {
  createRpcQueryUtils,
  fetchStreamSnapshot,
  isEffectRpcQueryError,
} from "#effect-api-query";

import { captureFailure } from "./fixtures/async.ts";
import { makeRpcTestClient } from "./fixtures/effect-rpc.ts";

const trackSnapshotSubscription = (queryClient: QueryClient) => {
  const cache = queryClient.getQueryCache();
  const subscribe = cache.subscribe.bind(cache);
  const listener = vi.fn<Parameters<typeof cache.subscribe>[0]>();
  const cleanup = vi.fn<() => void>();
  const subscription = vi
    .spyOn(cache, "subscribe")
    .mockImplementationOnce((notify) => {
      listener.mockImplementation(notify);
      cleanup.mockImplementation(subscribe(listener));
      return cleanup;
    });
  return { listener, cleanup, subscription };
};

describe("stream snapshots", () => {
  /* oxlint-disable vitest/max-expects */
  it.effect(
    "uses cached snapshots without acquiring a stream and requires ownership for fresh capture",
    () =>
      Effect.gen(function* capturesCachedSnapshotsWithOwnership() {
        const group = RpcGroup.make(
          Rpc.make("watch", { success: Schema.Int, stream: true })
        );
        const entered = yield* Deferred.make<boolean>();
        const emit = yield* Deferred.make<boolean>();
        const finalized = yield* Deferred.make<boolean>();
        let executions = 0;
        const client = yield* makeRpcTestClient(group, {
          watch: () =>
            Stream.fromEffect(
              Effect.sync(() => {
                executions += 1;
              }).pipe(
                Effect.andThen(Deferred.succeed(entered, true)),
                Effect.andThen(Deferred.await(emit)),
                Effect.as(1)
              )
            ).pipe(
              Stream.concat(Stream.never),
              Stream.ensuring(Deferred.succeed(finalized, true))
            ),
        });
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["snapshot"],
        });
        const options = rpc.watch.liveOptions({
          retry: false,
          staleTime: Infinity,
        });
        const queryClient = new QueryClient();
        const cache = queryClient.getQueryCache();
        const capture = trackSnapshotSubscription(queryClient);
        try {
          queryClient.setQueryData(options.queryKey, 0);
          expect(
            yield* Effect.promise(
              async () =>
                await fetchStreamSnapshot(queryClient, options, {
                  mode: "cached",
                })
            )
          ).toBe(0);
          expect(executions).toBe(0);
          expect(capture.subscription).not.toHaveBeenCalled();
          const pending = captureFailure(
            fetchStreamSnapshot(queryClient, options)
          );
          yield* Deferred.await(entered);
          yield* Effect.promise(async () => {
            await expect(
              fetchStreamSnapshot(queryClient, options)
            ).rejects.toThrow("idle query without observers");
          });
          expect(Deferred.isDoneUnsafe(finalized)).toBe(false);
          yield* Deferred.succeed(emit, true);
          expect(yield* Effect.promise(async () => await pending)).toBe(1);
          expect(Deferred.isDoneUnsafe(finalized)).toBe(true);
          expect(executions).toBe(1);
          const observer = new QueryObserver(queryClient, {
            ...options,
            enabled: false,
          });
          const stop = observer.subscribe(() => {});
          try {
            yield* Effect.promise(async () => {
              await expect(
                fetchStreamSnapshot(queryClient, options)
              ).rejects.toThrow("idle query without observers");
            });
            expect(
              yield* Effect.promise(
                async () =>
                  await fetchStreamSnapshot(queryClient, options, {
                    mode: "cached",
                  })
              )
            ).toBe(1);
          } finally {
            stop();
          }
          expect(queryClient.isFetching()).toBe(0);
          expect(capture.cleanup).toHaveBeenCalledOnce();
          capture.listener.mockClear();
          queryClient.setQueryData(["snapshot-listener-probe"], true);
          expect(capture.listener).not.toHaveBeenCalled();
        } finally {
          yield* Effect.promise(async () => {
            await queryClient.cancelQueries();
          });
          queryClient.clear();
          expect(cache.hasListeners()).toBe(false);
          capture.subscription.mockRestore();
        }
      })
  );
  /* oxlint-enable vitest/max-expects */

  /* oxlint-disable vitest/max-expects */
  test.each(["global", "prefix"] as const)(
    "captures the current %s hash without cancelling or invalidating a historical observed query",
    async (hashing) => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            queryKeyHashFn: (key) => `old:${JSON.stringify(key)}`,
          },
        },
      });
      const queryKey = ["snapshot-hash", hashing];
      const entered = Deferred.makeUnsafe<boolean>();
      let oldSignal: AbortSignal | undefined;
      const observer = new QueryObserver(queryClient, {
        queryKey,
        queryFn: async ({ signal }) => {
          oldSignal = signal;
          queryClient.setQueryData(queryKey, 1);
          Deferred.doneUnsafe(entered, Exit.succeed(true));
          return await Effect.runPromise(Effect.never, { signal }).catch(
            () => 1
          );
        },
      });
      const unsubscribe = observer.subscribe(() => {});
      let executions = 0;
      let finalized = false;
      const options = {
        queryKey,
        queryFn: async ({ signal }: { readonly signal: AbortSignal }) => {
          executions += 1;
          queryClient.setQueryData(queryKey, 2);
          await Effect.runPromise(Effect.never, { signal }).catch(() => {});
          finalized = true;
          return 2;
        },
      };
      const capture = trackSnapshotSubscription(queryClient);
      try {
        await Effect.runPromise(Deferred.await(entered));
        const historical = observer.getCurrentQuery();
        const currentDefaults = {
          retry: false as const,
          queryKeyHashFn: (key: readonly unknown[]) =>
            `new:${JSON.stringify(key)}`,
        };
        if (hashing === "global") {
          queryClient.setDefaultOptions({ queries: currentDefaults });
        } else {
          queryClient.setQueryDefaults(["snapshot-hash"], currentDefaults);
        }
        await expect(fetchStreamSnapshot(queryClient, options)).resolves.toBe(
          2
        );
        expect(finalized).toBe(true);
        expect(historical.state).toMatchObject({
          data: 1,
          fetchStatus: "fetching",
          isInvalidated: false,
        });
        expect(oldSignal?.aborted).toBe(false);
        expect(queryClient.getQueryData(queryKey)).toBe(2);
        await expect(
          fetchStreamSnapshot(queryClient, options, { mode: "cached" })
        ).resolves.toBe(2);
        expect(executions).toBe(1);
        expect(capture.subscription).toHaveBeenCalledOnce();
        expect(capture.cleanup).toHaveBeenCalledOnce();
        capture.listener.mockClear();
        queryClient.setQueryData(["snapshot-listener-probe"], true);
        expect(capture.listener).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
        await queryClient.cancelQueries();
        queryClient.clear();
        expect(queryClient.getQueryCache().hasListeners()).toBe(false);
        capture.subscription.mockRestore();
      }
    }
  );
  /* oxlint-enable vitest/max-expects */

  test.each(["global", "prefix"] as const)(
    "times out cached %s capture when only a historical hash has data",
    async (hashing) => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            queryKeyHashFn: (key) => `old:${JSON.stringify(key)}`,
          },
        },
      });
      const queryKey = ["snapshot-timeout", hashing];
      queryClient.setQueryData(queryKey, 1);
      const currentDefaults = {
        retry: false as const,
        queryKeyHashFn: (key: readonly unknown[]) =>
          `new:${JSON.stringify(key)}`,
      };
      if (hashing === "global") {
        queryClient.setDefaultOptions({ queries: currentDefaults });
      } else {
        queryClient.setQueryDefaults(["snapshot-timeout"], currentDefaults);
      }
      let finalized = false;
      const capture = trackSnapshotSubscription(queryClient);
      try {
        await expect(
          fetchStreamSnapshot(
            queryClient,
            {
              queryKey,
              queryFn: async ({ signal }) => {
                try {
                  return await Effect.runPromise(Effect.never, { signal });
                } finally {
                  finalized = true;
                }
              },
            },
            { mode: "cached", timeoutMs: 10 }
          )
        ).rejects.toMatchObject({ name: "TimeoutError" });
        expect({
          finalized,
          fetching: queryClient.isFetching(),
          listeners: queryClient.getQueryCache().hasListeners(),
          cleanupCalls: capture.cleanup.mock.calls.length,
        }).toStrictEqual({
          finalized: true,
          fetching: 0,
          listeners: false,
          cleanupCalls: 1,
        });
        capture.listener.mockClear();
        queryClient.setQueryData(["snapshot-listener-probe"], true);
        expect(capture.listener).not.toHaveBeenCalled();
      } finally {
        await queryClient.cancelQueries();
        queryClient.clear();
        capture.subscription.mockRestore();
      }
    }
  );

  describe.each(["ensuring", "acquireRelease"] as const)(
    "client-side %s snapshot cleanup",
    (finalizer) => {
      test.each(["live", "streamed"] as const)(
        "waits for cleanup and preserves its complete Cause in %s queries",
        async (operation) => {
          const group = RpcGroup.make(
            Rpc.make("watch", { success: Schema.Int, stream: true })
          );
          const closing = Deferred.makeUnsafe<boolean>();
          const release = Deferred.makeUnsafe<boolean>();
          const cause = Cause.combine(
            Cause.die(new Error("first release failed")),
            Cause.die(new Error("second release failed"))
          );
          const cleanup = Deferred.succeed(closing, true).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Effect.failCause(cause))
          );
          const values = Stream.succeed(1).pipe(Stream.concat(Stream.never));
          const source =
            finalizer === "ensuring"
              ? values.pipe(Stream.ensuring(cleanup))
              : Stream.unwrap(
                  Effect.acquireRelease(Effect.void, () => cleanup).pipe(
                    Effect.as(values)
                  )
                );
          /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
          const client = (() => source) as RpcClient.RpcClient.Flat<
            RpcGroup.Rpcs<typeof group>
          >;
          /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
          const rpc = createRpcQueryUtils(group, {
            client,
            keyPrefix: ["snapshot-client-cleanup", finalizer, operation],
          });
          const queryClient = new QueryClient();
          const pending =
            operation === "live"
              ? fetchStreamSnapshot(queryClient, rpc.watch.liveOptions())
              : fetchStreamSnapshot(queryClient, rpc.watch.streamedOptions());
          let settled = false;
          const outcome = captureFailure(pending).then((result) => {
            settled = true;
            return result;
          });
          try {
            await Effect.runPromise(Deferred.await(closing));
            expect(settled).toBe(false);
            Effect.runSync(Deferred.succeed(release, true));
            const error = await outcome;
            expect(error).toMatchObject({
              _tag: "EffectRpcQueryError",
              rpcTag: "watch",
              operation,
            });
            if (!isEffectRpcQueryError(error)) {
              throw new TypeError("Expected an RPC execution error");
            }
            expect(Equal.equals(error.cause, cause)).toBe(true);
            expect(queryClient.isFetching()).toBe(0);
          } finally {
            Effect.runSync(Deferred.succeed(release, true));
            await queryClient.cancelQueries();
            await outcome;
            queryClient.clear();
          }
        }
      );
    }
  );

  test.each(["timeout", "abort", "cleanup-failure"] as const)(
    "settles a %s snapshot after query cleanup",
    async (path) => {
      const queryClient = new QueryClient();
      const entered = Deferred.makeUnsafe<boolean>();
      const closing = Deferred.makeUnsafe<boolean>();
      const release = Deferred.makeUnsafe<boolean>();
      const controller = new AbortController();
      const abortReason = new Error("request aborted");
      const cleanupError = new Error("cleanup failed");
      let finalized = false;
      let settled = false;
      const options = {
        queryKey: ["snapshot-cleanup", path],
        retry: false,
        queryFn: async ({
          signal,
        }: {
          signal: AbortSignal;
        }): Promise<number> => {
          Deferred.doneUnsafe(entered, Exit.succeed(true));
          if (path === "cleanup-failure") {
            queryClient.setQueryData(options.queryKey, 1);
          }
          const interrupted = await captureFailure(
            Effect.runPromise(Effect.never, { signal })
          );
          Deferred.doneUnsafe(closing, Exit.succeed(true));
          await Effect.runPromise(Deferred.await(release));
          finalized = true;
          throw path === "cleanup-failure" ? cleanupError : interrupted;
        },
      };
      const capture = trackSnapshotSubscription(queryClient);
      const pending = fetchStreamSnapshot(queryClient, options, {
        signal: controller.signal,
        timeoutMs: path === "timeout" ? 10 : 1000,
      });
      const outcome = captureFailure(pending).then((result) => {
        settled = true;
        return result;
      });
      try {
        await Effect.runPromise(Deferred.await(entered));
        if (path === "abort") {
          controller.abort(abortReason);
        }
        await Effect.runPromise(Deferred.await(closing));
        expect({ settled, finalized }).toStrictEqual({
          settled: false,
          finalized: false,
        });
        Effect.runSync(Deferred.succeed(release, true));
        const result = await outcome;
        const failure = {
          timeout: { name: "TimeoutError" },
          abort: abortReason,
          "cleanup-failure": cleanupError,
        }[path];
        expect(result).toMatchObject(failure);
        expect(path === "timeout" || result === failure).toBe(true);
        expect({
          finalized,
          fetching: queryClient.isFetching(),
          listeners: queryClient.getQueryCache().hasListeners(),
          cleanupCalls: capture.cleanup.mock.calls.length,
        }).toStrictEqual({
          finalized: true,
          fetching: 0,
          listeners: false,
          cleanupCalls: 1,
        });
        capture.listener.mockClear();
        queryClient.setQueryData(["snapshot-listener-probe"], true);
        expect(capture.listener).not.toHaveBeenCalled();
      } finally {
        Effect.runSync(Deferred.succeed(release, true));
        await queryClient.cancelQueries();
        await outcome;
        queryClient.clear();
        capture.subscription.mockRestore();
      }
    }
  );

  test("rejects an aborted snapshot before executing the query", async () => {
    const queryClient = new QueryClient();
    const controller = new AbortController();
    const reason = new Error("request already aborted");
    controller.abort(reason);
    let executions = 0;
    const capture = trackSnapshotSubscription(queryClient);
    try {
      await expect(
        fetchStreamSnapshot(
          queryClient,
          {
            queryKey: ["aborted"],
            queryFn: async () => {
              executions += 1;
              return await Promise.resolve(1);
            },
          },
          { signal: controller.signal }
        )
      ).rejects.toBe(reason);
      expect(executions).toBe(0);
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
      expect(capture.subscription).not.toHaveBeenCalled();
    } finally {
      queryClient.clear();
      capture.subscription.mockRestore();
    }
  });
});
