import { expect, it } from "@effect/vitest";
import { QueryClient } from "@tanstack/query-core";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { Reactivity } from "effect/reactivity";

import {
  bindReactivityInvalidation,
  createRpcQueryUtils,
  QueryClientService,
} from "#effect-api-query";

import { group, makeClient } from "./fixtures/effect-rpc";

it.effect(
  "maps array and record keys to colocated filters with key prefix isolation",
  () =>
    Effect.gen(function* verifyBindings() {
      const queryClient = new QueryClient();
      const reactivity = yield* Reactivity.make;
      const client = yield* makeClient();
      const current = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["current"],
      });
      const other = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["other"],
      });
      const input = { id: 1 };
      const user = current.users.get.queryKey({ input });
      const otherUser = other.users.get.queryKey({ input });
      const health = current.health.ping.queryKey();
      queryClient.setQueryData(user, { id: 1, locale: "en", name: "Ada" });
      queryClient.setQueryData(otherUser, { id: 1, locale: "en", name: "Ada" });
      queryClient.setQueryData(health, null);

      const bridge = yield* bindReactivityInvalidation([
        {
          keys: ["users:1"],
          filter: current.users.get.queryFilter({
            view: "query",
            input,
            refetchType: "none",
          }),
        },
        {
          keys: { groups: [1] },
          filter: [
            current.users.queryFilter({ refetchType: "none" }),
            current.health.queryFilter({ refetchType: "none" }),
          ],
        },
      ]).pipe(
        Effect.provideService(Reactivity.Reactivity, reactivity),
        Effect.provideService(QueryClientService, queryClient)
      );

      reactivity.invalidateUnsafe(["users:2"]);
      yield* bridge.flush;
      expect(queryClient.getQueryState(user)?.isInvalidated).toBe(false);

      reactivity.invalidateUnsafe(["users:1"]);
      yield* bridge.flush;
      expect(queryClient.getQueryState(user)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(health)?.isInvalidated).toBe(false);

      queryClient.setQueryData(user, { id: 1, locale: "en", name: "Ada" });
      reactivity.invalidateUnsafe({ groups: [1] });
      yield* bridge.flush;
      expect(
        [user, health].map(
          (key) => queryClient.getQueryState(key)?.isInvalidated
        )
      ).toStrictEqual([true, true]);
      expect(queryClient.getQueryState(otherUser)?.isInvalidated).toBe(false);
    })
);

it.effect(
  "coalesces synchronous and batched triggers for each binding per microtask",
  () =>
    Effect.gen(function* verifyCoalescing() {
      const queryClient = new QueryClient();
      const reactivity = yield* Reactivity.make;
      const key = ["users"];
      queryClient.setQueryData(key, 1);
      let matches = 0;
      const bridge = yield* bindReactivityInvalidation([
        {
          keys: ["users:1", "users:2"],
          filter: {
            queryKey: key,
            refetchType: "none",
            predicate: () => {
              matches += 1;
              return true;
            },
          },
        },
      ]).pipe(
        Effect.provideService(Reactivity.Reactivity, reactivity),
        Effect.provideService(QueryClientService, queryClient)
      );

      reactivity.invalidateUnsafe(["users:1"]);
      reactivity.invalidateUnsafe(["users:2"]);
      yield* reactivity.withBatch(
        reactivity
          .invalidate(["users:1"])
          .pipe(Effect.andThen(reactivity.invalidate(["users:2"])))
      );
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);

      yield* bridge.flush;
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      expect(matches).toBe(1);

      reactivity.invalidateUnsafe(["users:1"]);
      yield* bridge.flush;
      expect(matches).toBe(2);
    })
);

it.effect("drops queued and later invalidations when the Scope closes", () =>
  Effect.gen(function* verifyScope() {
    const queryClient = new QueryClient();
    const reactivity = yield* Reactivity.make;
    const key = ["users"];
    queryClient.setQueryData(key, 1);

    const bridge = yield* Effect.scoped(
      Effect.gen(function* bindInScope() {
        const scopedBridge = yield* bindReactivityInvalidation([
          { keys: ["users:1"], filter: { queryKey: key, refetchType: "none" } },
        ]);
        reactivity.invalidateUnsafe(["users:1"]);
        return scopedBridge;
      })
    ).pipe(
      Effect.provideService(Reactivity.Reactivity, reactivity),
      Effect.provideService(QueryClientService, queryClient)
    );

    yield* bridge.flush;
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    reactivity.invalidateUnsafe(["users:1"]);
    yield* bridge.flush;
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  })
);

it.effect(
  "drops queued invalidations and ignores triggers while inactive",
  () =>
    Effect.gen(function* verifyGuard() {
      const queryClient = new QueryClient();
      const reactivity = yield* Reactivity.make;
      const key = ["users"];
      queryClient.setQueryData(key, 1);
      let active = true;
      const bridge = yield* bindReactivityInvalidation(
        [{ keys: ["users:1"], filter: { queryKey: key, refetchType: "none" } }],
        { isActive: () => active }
      ).pipe(
        Effect.provideService(Reactivity.Reactivity, reactivity),
        Effect.provideService(QueryClientService, queryClient)
      );

      reactivity.invalidateUnsafe(["users:1"]);
      yield* bridge.flush;
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);

      queryClient.setQueryData(key, 1);
      reactivity.invalidateUnsafe(["users:1"]);
      active = false;
      yield* bridge.flush;
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);

      reactivity.invalidateUnsafe(["users:1"]);
      active = true;
      yield* bridge.flush;
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    })
);

it.effect("strips undefined record entries and ignores empty bindings", () =>
  Effect.gen(function* verifyRecordKeys() {
    const queryClient = new QueryClient();
    const reactivity = yield* Reactivity.make;
    const key = ["users"];
    queryClient.setQueryData(key, 1);
    const keys = { groups: [1] };
    Reflect.set(keys, "missing", undefined);
    const empty = {};
    Reflect.set(empty, "missing", undefined);
    const filter = { queryKey: key, refetchType: "none" } as const;
    const bridge = yield* bindReactivityInvalidation([
      { keys, filter },
      { keys: empty, filter },
      { keys: [], filter },
    ]).pipe(
      Effect.provideService(Reactivity.Reactivity, reactivity),
      Effect.provideService(QueryClientService, queryClient)
    );

    reactivity.invalidateUnsafe(["missing"]);
    yield* bridge.flush;
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);

    reactivity.invalidateUnsafe({ groups: [1] });
    yield* bridge.flush;
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  })
);

it.effect(
  "flush waits for in-flight refetches and triggers that arrive while it waits",
  () =>
    Effect.gen(function* verifyFlush() {
      const queryClient = new QueryClient();
      const reactivity = yield* Reactivity.make;
      const runPromise = Effect.runPromiseWith(yield* Effect.context());
      const started = yield* Deferred.make<undefined>();
      const release = yield* Deferred.make<number>();
      const finished = yield* Deferred.make<undefined>();
      const user = ["user"];
      const groupKey = ["group"];
      queryClient.setQueryDefaults(user, {
        queryFn: async () =>
          await runPromise(
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release))
            )
          ),
      });
      queryClient.setQueryData(user, 1);
      queryClient.setQueryData(groupKey, 1);
      const bridge = yield* bindReactivityInvalidation([
        { keys: ["users:1"], filter: { queryKey: user, refetchType: "all" } },
        {
          keys: { groups: [] },
          filter: { queryKey: groupKey, refetchType: "none" },
        },
      ]).pipe(
        Effect.provideService(Reactivity.Reactivity, reactivity),
        Effect.provideService(QueryClientService, queryClient)
      );

      reactivity.invalidateUnsafe(["users:1"]);
      yield* Deferred.await(started);
      const waiter = yield* Effect.forkChild(
        bridge.flush.pipe(
          Effect.andThen(Deferred.succeed(finished, undefined))
        ),
        { startImmediately: true }
      );
      expect(yield* Deferred.isDone(finished)).toBe(false);
      reactivity.invalidateUnsafe(["groups"]);
      yield* Deferred.succeed(release, 2);
      yield* Fiber.join(waiter);
      expect(queryClient.getQueryData(user)).toBe(2);
      expect(queryClient.getQueryState(groupKey)?.isInvalidated).toBe(true);
    })
);

it.effect(
  "reports native refetch failures using default and per-binding options during mutations",
  () =>
    Effect.gen(function* verifyErrorReporting() {
      const queryClient = new QueryClient();
      const reactivity = yield* Reactivity.make;
      const runPromise = Effect.runPromiseWith(yield* Effect.context());
      const started = yield* Deferred.make<undefined>();
      const release = yield* Deferred.make<undefined>();
      const rejection = new Error("refetch failed");
      const predicateFailure = new Error("filter failed");
      const errors: unknown[] = [];
      const user = ["user"];
      const groupKey = ["group"];
      for (const key of [user, groupKey]) {
        queryClient.setQueryDefaults(key, {
          queryFn: async () => await Promise.reject(rejection),
          retry: false,
        });
        queryClient.setQueryData(key, 1);
      }
      const bridge = yield* bindReactivityInvalidation(
        [
          {
            keys: ["users:1"],
            filter: [
              { queryKey: user, refetchType: "all" },
              {
                queryKey: user,
                predicate: () => {
                  throw predicateFailure;
                },
              },
            ],
          },
          {
            keys: ["groups"],
            filter: { queryKey: groupKey, refetchType: "all" },
            options: { throwOnError: false },
          },
        ],
        {
          invalidateOptions: { throwOnError: true },
          onError: (error) => {
            errors.push(error);
            throw new Error("reporter failed");
          },
        }
      ).pipe(
        Effect.provideService(Reactivity.Reactivity, reactivity),
        Effect.provideService(QueryClientService, queryClient)
      );
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationFn: async () => {
          await runPromise(
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release))
            )
          );
        },
      });
      const running = mutation.execute(undefined);

      try {
        yield* Deferred.await(started);
        reactivity.invalidateUnsafe(["users:1", "groups"]);
        yield* bridge.flush;
        expect(queryClient.isMutating()).toBe(1);
        expect(
          [user, groupKey].map((key) => queryClient.getQueryState(key)?.error)
        ).toStrictEqual([rejection, rejection]);
        expect(errors).toHaveLength(2);
        expect(errors).toContain(rejection);
        expect(errors).toContain(predicateFailure);
      } finally {
        yield* Deferred.succeed(release, undefined);
        yield* Effect.promise(async () => {
          await running;
        });
      }
    })
);

it.effect(
  "coalesces triggers that arrive while a pass is in flight and releases concurrent flush waiters",
  () =>
    Effect.gen(function* verifyInFlightCoalescing() {
      const queryClient = new QueryClient();
      const reactivity = yield* Reactivity.make;
      const runPromise = Effect.runPromiseWith(yield* Effect.context());
      const started = yield* Deferred.make<undefined>();
      const release = yield* Deferred.make<number>();
      const user = ["user"];
      const groupKey = ["group"];
      let groupMatches = 0;

      queryClient.setQueryDefaults(user, {
        queryFn: async () =>
          await runPromise(
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release))
            )
          ),
      });
      queryClient.setQueryData(user, 1);
      queryClient.setQueryData(groupKey, 1);

      const bridge = yield* bindReactivityInvalidation([
        { keys: ["users:1"], filter: { queryKey: user, refetchType: "all" } },
        {
          keys: { groups: [1, 2] },
          filter: {
            queryKey: groupKey,
            refetchType: "none",
            predicate: () => {
              groupMatches += 1;
              return true;
            },
          },
        },
      ]).pipe(
        Effect.provideService(Reactivity.Reactivity, reactivity),
        Effect.provideService(QueryClientService, queryClient)
      );

      reactivity.invalidateUnsafe(["users:1"]);
      yield* Deferred.await(started);

      const firstWaiter = yield* Effect.forkChild(bridge.flush, {
        startImmediately: true,
      });
      const secondWaiter = yield* Effect.forkChild(bridge.flush, {
        startImmediately: true,
      });

      reactivity.invalidateUnsafe({ groups: [1] });
      reactivity.invalidateUnsafe({ groups: [2] });
      yield* Deferred.succeed(release, 2);

      yield* Fiber.join(firstWaiter);
      yield* Fiber.join(secondWaiter);

      expect(queryClient.getQueryData(user)).toBe(2);
      expect(queryClient.getQueryState(groupKey)?.isInvalidated).toBe(true);
      expect(groupMatches).toBe(1);
    })
);

it.effect(
  "unblocks flush and stops queued work when the Scope closes during an in-flight invalidation",
  () =>
    Effect.gen(function* verifyScopeCloseDuringInFlight() {
      const queryClient = new QueryClient();
      const reactivity = yield* Reactivity.make;
      const runPromise = Effect.runPromiseWith(yield* Effect.context());
      const started = yield* Deferred.make<undefined>();
      const release = yield* Deferred.make<number>();
      const user = ["user"];
      const groupKey = ["group"];

      queryClient.setQueryDefaults(user, {
        queryFn: async () =>
          await runPromise(
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release))
            )
          ),
      });
      queryClient.setQueryData(user, 1);
      queryClient.setQueryData(groupKey, 1);

      const scope = yield* Scope.make();
      const bridge = yield* bindReactivityInvalidation([
        { keys: ["users:1"], filter: { queryKey: user, refetchType: "all" } },
        {
          keys: ["groups"],
          filter: { queryKey: groupKey, refetchType: "none" },
        },
      ]).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provideService(Reactivity.Reactivity, reactivity),
        Effect.provideService(QueryClientService, queryClient)
      );

      reactivity.invalidateUnsafe(["users:1"]);
      yield* Deferred.await(started);
      const waiter = yield* Effect.forkChild(bridge.flush, {
        startImmediately: true,
      });
      reactivity.invalidateUnsafe(["groups"]);

      yield* Scope.close(scope, Exit.void);
      yield* Fiber.join(waiter);
      expect(queryClient.getQueryState(groupKey)?.isInvalidated).toBe(false);

      yield* Deferred.succeed(release, 2);
      yield* bridge.flush;
    })
);
