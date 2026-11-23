import { expect, it } from "@effect/vitest";
import {
  CancelledError,
  QueryClient,
  QueryObserver,
} from "@tanstack/query-core";
import { Cause, Deferred, Effect, Exit, Fiber, Schema, Stream } from "effect";
import { Reactivity } from "effect/reactivity";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  acquireQueryOwner,
  createRpcQueryUtils,
  EffectRpcQueryError,
  EffectHttpApiQueryError,
  queryEffects,
  QueryClientService,
  QueryClientOperationError,
} from "#effect-api-query";

import { directory, directoryEffects } from "../examples/shared/query-effects";
import {
  makeObjectRpcTestClient,
  makeRpcTestClient,
} from "./fixtures/effect-rpc";
import { waitForQueryState } from "./fixtures/query-cache";

it.effect(
  "shares queried data with direct QueryClient consumers and typed updates",
  () =>
    Effect.gen(function* scenario0() {
      const client = new QueryClient();
      const options = {
        queryKey: ["bridge"],
        queryFn: async () => await Promise.resolve(42),
      };
      const program = Effect.gen(function* scenario1() {
        expect(yield* queryEffects.query(options)).toBe(42);
        expect(yield* queryEffects.getData(options.queryKey)).toBe(42);
        yield* queryEffects.setData<number>(
          options.queryKey,
          (old) => (old ?? 0) + 1
        );
        yield* queryEffects.invalidate({
          queryKey: options.queryKey,
          refetchType: "none",
        });
      });
      yield* program.pipe(Effect.provideService(QueryClientService, client));
      expect(client.getQueryData(options.queryKey)).toBe(43);
      expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(true);
      client.clear();
    })
);

it.effect(
  "interrupts one waiter without cancelling shared fetching or an observer",
  () =>
    Effect.gen(function* scenario2() {
      const client = new QueryClient();
      const started = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<number>();
      const group = RpcGroup.make(Rpc.make("read", { success: Schema.Int }));
      let executions = 0;
      const ready = yield* makeRpcTestClient(group, {
        read: () =>
          Effect.gen(function* scenario3() {
            executions += 1;
            yield* Deferred.succeed(started, true);
            return yield* Deferred.await(release);
          }),
      });
      const utils = createRpcQueryUtils(group, {
        client: ready,
        keyPrefix: ["concurrent"],
      });
      const options = utils.read.queryOptions({
        select: (value) => `value:${value}`,
      });
      const observer = new QueryObserver(client, options);
      const unsubscribe = observer.subscribe(() => {});
      const run = queryEffects
        .query(options)
        .pipe(Effect.provideService(QueryClientService, client));
      const first = yield* Effect.forkChild(run);
      yield* Deferred.await(started);
      const second = yield* Effect.forkChild(
        queryEffects
          .query(options)
          .pipe(Effect.provideService(QueryClientService, client))
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(first);
      expect(client.getQueryState(options.queryKey)?.fetchStatus).toBe(
        "fetching"
      );
      yield* Deferred.succeed(release, 17);
      expect(yield* Fiber.join(second)).toBe("value:17");
      expect(observer.getCurrentResult().data).toBe("value:17");
      expect(client.getQueryData(options.queryKey)).toBe(17);
      expect(executions).toBe(1);
      unsubscribe();
      client.clear();
    })
);

it.effect(
  "preserves the complete failed Exit and distinguishes runner rejection",
  () =>
    Effect.gen(function* scenario4() {
      const group = RpcGroup.make(
        Rpc.make("read", { success: Schema.Int, error: Schema.String })
      );
      const ready = yield* makeRpcTestClient(group, {
        read: () => Effect.fail("denied"),
      });
      const run = Effect.runPromiseExitWith(yield* Effect.context());
      let observedCause: unknown;
      const client = new QueryClient();
      const utils = createRpcQueryUtils(group, {
        client: ready,
        keyPrefix: ["failure"],
        runtime: async (effect, options) => {
          const exit = await run(effect, options);
          if (Exit.isFailure(exit)) {
            const cause = Cause.combine(
              exit.cause,
              Cause.die(new Error("defect"))
            );
            observedCause = cause;
            return Exit.failCause(cause);
          }
          return exit;
        },
      });
      const failure = yield* queryEffects
        .query(utils.read.queryOptions())
        .pipe(Effect.flip, Effect.provideService(QueryClientService, client));
      expect(failure).toBeInstanceOf(QueryClientOperationError);
      expect(failure.cause).toBeInstanceOf(EffectRpcQueryError);
      if (failure.cause instanceof EffectRpcQueryError) {
        expect(failure.cause.cause).toBe(observedCause);
        expect(failure.cause.cause.reasons).toHaveLength(2);
        expect(client.getQueryState(utils.read.queryKey())?.error).toBe(
          failure.cause
        );
      }
      const rejection = new Error("runner rejected without Exit");
      const rejecting = createRpcQueryUtils(group, {
        client: ready,
        keyPrefix: ["rejection"],
        runtime: async () => await Promise.reject(rejection),
      });
      const runnerFailure = yield* queryEffects
        .query(rejecting.read.queryOptions())
        .pipe(Effect.flip, Effect.provideService(QueryClientService, client));
      expect(runnerFailure).toBeInstanceOf(QueryClientOperationError);
      expect(runnerFailure.cause).toBe(rejection);
      const callbackFailure = yield* queryEffects
        .setData(utils.read.queryKey(), () => {
          throw rejection;
        })
        .pipe(Effect.flip, Effect.provideService(QueryClientService, client));
      expect(callbackFailure.cause).toBe(rejection);
      client.clear();
    })
);

it.effect(
  "invalidates generated filters with native active refetch behavior",
  () =>
    Effect.gen(function* activeRefetch() {
      const group = RpcGroup.make(Rpc.make("read", { success: Schema.Int }));
      let revision = 0;
      const ready = yield* makeRpcTestClient(group, {
        read: () =>
          Effect.sync(() => {
            revision += 1;
            return revision;
          }),
      });
      const utils = createRpcQueryUtils(group, {
        client: ready,
        keyPrefix: ["refresh"],
      });
      const client = new QueryClient();
      const options = utils.read.queryOptions({ staleTime: Infinity });
      const observer = new QueryObserver(client, options);
      const unsubscribe = observer.subscribe(() => {});
      yield* queryEffects
        .query(options)
        .pipe(Effect.provideService(QueryClientService, client));
      yield* queryEffects
        .invalidate(utils.read.queryFilter({ view: "query" }))
        .pipe(Effect.provideService(QueryClientService, client));
      expect(client.getQueryData(options.queryKey)).toBe(2);
      expect(observer.getCurrentResult().data).toBe(2);
      expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(false);
      unsubscribe();
      client.clear();
    })
);

it.effect(
  "runs the complete application event workflow against its supplied cache",
  () =>
    Effect.gen(function* applicationWorkflow() {
      const ready = yield* makeObjectRpcTestClient(directory, {
        "users.read": ({ id }) => Effect.succeed({ id, name: "Ada" }),
      });
      const client = new QueryClient();
      const application = directoryEffects(ready, client);
      expect(yield* application.renameFromEvent(1, "Grace")).toStrictEqual({
        id: 1,
        name: "Grace",
      });
      const key = application.rpc.users.read.queryKey({ input: { id: 1 } });
      expect(client.getQueryData(key)).toStrictEqual({ id: 1, name: "Grace" });
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      client.setQueryData(key, { id: 1, name: "Grace" });
      const reactivity = yield* Reactivity.make;
      const bridge = yield* application
        .bindUserRefresh(1)
        .pipe(Effect.provideService(Reactivity.Reactivity, reactivity));
      reactivity.invalidateUnsafe(["users:2"]);
      yield* bridge.flush;
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      reactivity.invalidateUnsafe(["users:1"]);
      yield* bridge.flush;
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      client.clear();
    })
);

it.effect(
  "retires owner-tracked coalesced work after a bridge waiter leaves its native observer",
  () =>
    Effect.gen(function* retiresSharedOwner() {
      const pending = yield* Deferred.make<boolean>();
      const events: string[] = [];
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      const ready = yield* makeRpcTestClient(group, {
        watch: () =>
          Stream.make(1, 2).pipe(
            Stream.concat(
              Stream.fromEffect(
                Deferred.succeed(pending, true).pipe(
                  Effect.andThen(Effect.never)
                )
              )
            ),
            Stream.ensuring(
              Effect.sync(() => {
                events.push("cleaned");
              })
            )
          ),
      });
      const owner = yield* Effect.promise(
        async () =>
          await acquireQueryOwner(async (setup) => {
            await setup.acquire(
              () => ready,
              () => {
                events.push("released");
              }
            );
            return setup.trackUtils(
              createRpcQueryUtils(group, {
                client: ready,
                keyPrefix: ["bridge-owner"],
              })
            );
          })
      );
      const options = owner.resources.watch.liveOptions({
        coalesceMs: 60_000,
        retry: false,
      });
      const observer = new QueryObserver(owner.queryClient, options);
      const stop = observer.subscribe(() => {});
      try {
        const waiter = yield* Effect.forkChild(
          queryEffects
            .query(options)
            .pipe(Effect.provideService(QueryClientService, owner.queryClient))
        );
        yield* Deferred.await(pending);
        yield* waitForQueryState(
          owner.queryClient,
          () => owner.queryClient.getQueryData(options.queryKey) === 1
        );
        yield* Fiber.interrupt(waiter);
        expect(
          owner.queryClient.getQueryState(options.queryKey)?.fetchStatus
        ).toBe("fetching");
        expect(owner.queryClient.getQueryData(options.queryKey)).toBe(1);
        expect(events).toStrictEqual([]);
        yield* Effect.promise(async () => {
          await owner.dispose();
        });
        expect(events).toStrictEqual(["cleaned", "released"]);
        expect({
          queries: owner.queryClient.getQueryCache().getAll(),
          active: owner.isActive(),
        }).toStrictEqual({ queries: [], active: false });
      } finally {
        stop();
        yield* Effect.promise(async () => {
          await owner.dispose();
        });
      }
    })
);

for (const rejection of [
  new EffectHttpApiQueryError(
    { apiId: "foreign", groupId: "users", endpoint: "read", method: "GET" },
    "query",
    Cause.fail(123)
  ),
  new EffectRpcQueryError("read", "query", Cause.fail(123)),
]) {
  it.effect(
    `query retains a runner rejection with ${rejection._tag} as an unknown cause`,
    () =>
      Effect.gen(function* foreignRunnerFailure() {
        const group = RpcGroup.make(
          Rpc.make("read", {
            success: Schema.Int,
            error: Schema.Literal("missing"),
          })
        );
        const ready = yield* makeRpcTestClient(group, {
          read: () => Effect.fail("missing"),
        });
        const utils = createRpcQueryUtils(group, {
          client: ready,
          keyPrefix: ["foreign-rejection", rejection._tag],
          runtime: async () => await Promise.reject(rejection),
        });
        const client = new QueryClient();
        const failure = yield* queryEffects
          .query(utils.read.queryOptions({ retry: false }))
          .pipe(Effect.flip, Effect.provideService(QueryClientService, client));
        expect(failure).toBeInstanceOf(QueryClientOperationError);
        expect(failure.cause).toBe(rejection);
        expect(client.getQueryState(utils.read.queryKey())?.error).toBe(
          rejection
        );
        client.clear();
      })
  );
}

it.effect("does not mutate caller-supplied query options in place", () =>
  Effect.gen(function* preservesCallerOptions() {
    const client = new QueryClient();
    const rawOptions = Object.freeze({
      queryKey: ["immutable-raw"] as const,
      queryFn: async () => await Promise.resolve(11),
      staleTime: 0,
    });
    const rawSnapshot = { ...rawOptions };
    const rawResult = yield* queryEffects
      .query(rawOptions)
      .pipe(Effect.provideService(QueryClientService, client));
    expect(rawResult).toBe(11);
    expect(rawOptions).toStrictEqual(rawSnapshot);

    const rawWithDefaults = {
      queryKey: ["immutable-defaulted"] as const,
      queryFn: async () => await Promise.resolve(22),
      staleTime: 0,
    };
    const defaultedOptions = Object.freeze({
      ...client.defaultQueryOptions(rawWithDefaults),
      queryFn: rawWithDefaults.queryFn,
    });
    const defaultedSnapshot = { ...defaultedOptions };
    const defaultedResult = yield* queryEffects
      .query(defaultedOptions)
      .pipe(Effect.provideService(QueryClientService, client));
    expect(defaultedResult).toBe(22);
    expect(defaultedOptions).toStrictEqual(defaultedSnapshot);
    client.clear();
  })
);

it.effect("selects fresh and static results while caching decoded data", () =>
  Effect.gen(function* cacheReuseSemantics() {
    const client = new QueryClient();
    const queryKey = ["cache-reuse"] as const;
    let executions = 0;
    const options = {
      queryKey,
      queryFn: async () => {
        executions += 1;
        return await Promise.resolve(executions);
      },
      select: (value: number) => `selected:${value}`,
    };
    yield* Effect.gen(function* reuse() {
      expect(
        yield* queryEffects.query({ ...options, staleTime: "static" })
      ).toBe("selected:1");
      yield* queryEffects.invalidate({ queryKey, refetchType: "none" });
      expect(
        yield* queryEffects.query({ ...options, staleTime: "static" })
      ).toBe("selected:1");
      expect(yield* queryEffects.query({ ...options, staleTime: 0 })).toBe(
        "selected:2"
      );
    }).pipe(Effect.provideService(QueryClientService, client));
    expect(client.getQueryData(queryKey)).toBe(2);
    client.clear();
  })
);

it.effect("selects multiple pages from frozen infinite options", () =>
  Effect.gen(function* frozenInfinite() {
    const client = new QueryClient();
    const queryKey = ["frozen-infinite"] as const;
    const options = Object.freeze({
      queryKey,
      queryFn: async ({ pageParam }: { pageParam: string }) =>
        await Promise.resolve(pageParam),
      initialPageParam: "a",
      getNextPageParam: (page: string) => `${page}b`,
      pages: 2,
      select: ({ pages }: { pages: string[] }) => pages.join(","),
    });
    const selected = yield* queryEffects
      .infiniteQuery(options)
      .pipe(Effect.provideService(QueryClientService, client));
    expect(selected).toBe("a,ab");
    expect(client.getQueryData(queryKey)).toStrictEqual({
      pages: ["a", "ab"],
      pageParams: ["a", "ab"],
    });
    client.clear();
  })
);

it.effect(
  "warms caches from frozen options and swallows prefetch failures",
  () =>
    Effect.gen(function* warmsCaches() {
      const client = new QueryClient();
      const failure = new Error("unavailable");
      const failing = {
        queryKey: ["failing-prefetch"],
        queryFn: async () => await Promise.reject(failure),
      };
      const infinite = { initialPageParam: 1 };
      yield* Effect.gen(function* prefetchQueries() {
        yield* queryEffects.prefetch({
          ...failing,
          queryKey: ["warm"],
          queryFn: () => 42,
        });
        yield* queryEffects.prefetchInfinite(
          Object.freeze({
            ...infinite,
            queryKey: ["warm-infinite"],
            queryFn: ({ pageParam }: { pageParam: number }) => pageParam,
          })
        );
        yield* queryEffects.prefetch(failing);
        yield* queryEffects.prefetchInfinite(
          Object.freeze({
            ...infinite,
            ...failing,
            queryKey: ["failing-infinite"],
          })
        );
      }).pipe(Effect.provideService(QueryClientService, client));
      expect(client.getQueryData(["warm"])).toBe(42);
      expect(client.getQueryData(["warm-infinite"])).toStrictEqual({
        pages: [1],
        pageParams: [1],
      });
      expect(client.getQueryState(failing.queryKey)?.error).toBe(failure);
      expect(client.getQueryState(["failing-infinite"])?.error).toBe(failure);
      client.clear();
    })
);

for (const abortFrom of ["fiber", "caller"] as const) {
  it.effect(
    `cleans up an exclusive stream snapshot on ${abortFrom} abort`,
    () => {
      const controller = new AbortController();
      return Effect.gen(function* abortSnapshot() {
        const client = new QueryClient();
        const reason = new Error("capture stopped");
        const started = yield* Deferred.make<boolean>();
        const cleaned = yield* Deferred.make<boolean>();
        const group = RpcGroup.make(
          Rpc.make("watch", { success: Schema.Int, stream: true })
        );
        const ready = yield* makeRpcTestClient(group, {
          watch: () =>
            Stream.fromEffect(
              Deferred.succeed(started, true).pipe(Effect.andThen(Effect.never))
            ).pipe(Stream.ensuring(Deferred.succeed(cleaned, true))),
        });
        const utils = createRpcQueryUtils(group, { client: ready });
        const options = utils.watch.liveOptions();
        const capture = queryEffects.streamSnapshot(options, {
          signal: controller.signal,
        });
        const fiber = yield* Effect.forkChild(
          capture.pipe(Effect.provideService(QueryClientService, client))
        );
        try {
          yield* Deferred.await(started);
          if (abortFrom === "fiber") {
            yield* Fiber.interrupt(fiber);
            expect(controller.signal.aborted).toBe(false);
          } else {
            controller.abort(reason);
            const failure = yield* Fiber.join(fiber).pipe(Effect.flip);
            expect(failure).toBeInstanceOf(QueryClientOperationError);
            expect(failure.cause).toBe(reason);
          }
          yield* Deferred.await(cleaned);
          expect(client.getQueryState(options.queryKey)?.fetchStatus).toBe(
            "idle"
          );
        } finally {
          client.clear();
        }
      });
    }
  );
}

for (const operation of ["invalidate", "refetch", "reset"] as const) {
  it.effect(
    `interrupts the ${operation} waiter while active refetch completes`,
    () =>
      Effect.gen(function* interruptRefetchWaiter() {
        const client = new QueryClient();
        const queryKey = [operation] as const;
        const started = yield* Deferred.make<boolean>();
        const release = yield* Deferred.make<number>();
        const run = Effect.runPromiseWith(yield* Effect.context());
        const observer = new QueryObserver(client, {
          queryKey,
          initialData: 1,
          staleTime: Infinity,
          queryFn: async ({ signal }) =>
            await run(
              Deferred.succeed(started, true).pipe(
                Effect.andThen(Deferred.await(release))
              ),
              { signal }
            ),
        });
        const stop = observer.subscribe(() => {});
        try {
          yield* Effect.gen(function* refetch() {
            const waiter = yield* Effect.forkChild(
              queryEffects[operation]({ queryKey })
            );
            yield* Deferred.await(started);
            yield* Fiber.interrupt(waiter);
            expect(yield* queryEffects.isFetching({ queryKey })).toBe(1);
            yield* Deferred.succeed(release, 2);
            yield* waitForQueryState(
              client,
              () => observer.getCurrentResult().data === 2
            );
            expect(yield* queryEffects.isFetching({ queryKey })).toBe(0);
            expect((yield* queryEffects.getState(queryKey))?.data).toBe(2);
          }).pipe(Effect.provideService(QueryClientService, client));
        } finally {
          stop();
          client.clear();
        }
      })
  );
}

it.effect("cancels and removes only the matching cache entry", () =>
  Effect.gen(function* cancelAndRemove() {
    const client = new QueryClient();
    const queryKey = ["cancel-me"] as const;
    const started = yield* Deferred.make<boolean>();
    const run = Effect.runPromiseWith(yield* Effect.context());
    const options = {
      queryKey,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        await run(
          Deferred.succeed(started, true).pipe(Effect.andThen(Effect.never)),
          { signal }
        ),
    };
    try {
      yield* Effect.gen(function* cancel() {
        yield* queryEffects.setData<number>(["keep-me"], 1);
        const waiter = yield* Effect.forkChild(
          queryEffects.query(options).pipe(Effect.flip)
        );
        yield* Deferred.await(started);
        yield* queryEffects.cancel({ queryKey });
        const failure = yield* Fiber.join(waiter);
        expect(failure.cause).toBeInstanceOf(CancelledError);
        expect((yield* queryEffects.getState(queryKey))?.fetchStatus).toBe(
          "idle"
        );
        yield* queryEffects.remove({ queryKey });
        expect(yield* queryEffects.getState(queryKey)).toBeUndefined();
        expect(yield* queryEffects.getData(["keep-me"])).toBe(1);
      }).pipe(Effect.provideService(QueryClientService, client));
    } finally {
      client.clear();
    }
  })
);
