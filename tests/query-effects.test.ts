import { expect, it } from "@effect/vitest";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { Cause, Deferred, Effect, Exit, Fiber, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  acquireQueryOwner,
  configureUtils,
  createRpcQueryUtils,
  createQueryFilter,
  EffectRpcQueryError,
  EffectHttpApiQueryError,
  queryEffects,
  QueryClientService,
  QueryClientOperationError,
} from "#effect-api-query";

import { directory, directoryEffects } from "../examples/shared/query-effects";
import { makeRpcTestClient } from "./fixtures/effect-rpc";
import { waitForQueryState } from "./fixtures/query-cache";

it.effect(
  "shares ensured data with direct QueryClient consumers and typed updates",
  () =>
    Effect.gen(function* scenario0() {
      const client = new QueryClient();
      const options = {
        queryKey: ["bridge"],
        queryFn: async () => await Promise.resolve(42),
      };
      const program = Effect.gen(function* scenario1() {
        expect(yield* queryEffects.ensure(options)).toBe(42);
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
        .fetch(options)
        .pipe(Effect.provideService(QueryClientService, client));
      const first = yield* Effect.forkChild(run);
      yield* Deferred.await(started);
      const second = yield* Effect.forkChild(
        queryEffects
          .ensure(options)
          .pipe(Effect.provideService(QueryClientService, client))
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(first);
      expect(client.getQueryState(options.queryKey)?.fetchStatus).toBe(
        "fetching"
      );
      yield* Deferred.succeed(release, 17);
      expect(yield* Fiber.join(second)).toBe(17);
      expect(observer.getCurrentResult().data).toBe("value:17");
      expect(client.getQueryData(options.queryKey)).toBe(17);
      expect(executions).toBe(1);
      unsubscribe();
      client.clear();
    })
);

for (const operation of ["fetch", "ensure"] as const) {
  it.effect(
    `${operation} preserves the complete failed Exit and distinguishes runner rejection`,
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
        const failure = yield* queryEffects[operation](
          utils.read.queryOptions()
        ).pipe(Effect.flip, Effect.provideService(QueryClientService, client));
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
          .ensure(rejecting.read.queryOptions())
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
}

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
        .ensure(options)
        .pipe(Effect.provideService(QueryClientService, client));
      yield* queryEffects
        .invalidate(createQueryFilter(utils.read, "query")())
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
      const ready = yield* makeRpcTestClient(directory, {
        "users.read": ({ id }) => Effect.succeed({ id, name: "Ada" }),
      });
      const client = new QueryClient();
      const application = directoryEffects(ready, client);
      expect(yield* application.renameFromEvent(1, "Grace")).toStrictEqual({
        id: 1,
        name: "Grace",
      });
      const key = application.rpc.users.read.queryKey({ id: 1 });
      expect(client.getQueryData(key)).toStrictEqual({ id: 1, name: "Grace" });
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
            return configureUtils(
              createRpcQueryUtils(group, {
                client: ready,
                keyPrefix: ["bridge-owner"],
                runtime: setup.wrapRunner(Effect.runPromiseExit),
              }),
              {
                live: {
                  interceptors: [
                    async ({ next, context }) =>
                      await setup.runQuery(next, context.signal),
                  ],
                },
              }
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
            .fetch(options)
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

for (const operation of ["fetch", "ensure"] as const) {
  for (const rejection of [
    new EffectHttpApiQueryError(
      { apiId: "foreign", groupId: "users", endpoint: "read", method: "GET" },
      "query",
      Cause.fail(123)
    ),
    new EffectRpcQueryError("read", "query", Cause.fail(123)),
  ]) {
    it.effect(
      `${operation} retains a runner rejection with ${rejection._tag} as an unknown cause`,
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
            keyPrefix: ["foreign-rejection", operation, rejection._tag],
            runtime: async () => await Promise.reject(rejection),
          });
          const client = new QueryClient();
          const failure = yield* queryEffects[operation](
            utils.read.queryOptions({ retry: false })
          ).pipe(
            Effect.flip,
            Effect.provideService(QueryClientService, client)
          );
          expect(failure).toBeInstanceOf(QueryClientOperationError);
          expect(failure.cause).toBe(rejection);
          expect(client.getQueryState(utils.read.queryKey())?.error).toBe(
            rejection
          );
          client.clear();
        })
    );
  }
}

for (const operation of ["fetch", "ensure"] as const) {
  it.effect(
    `${operation} does not mutate caller-supplied query options in place`,
    () =>
      Effect.gen(function* preservesCallerOptions() {
        const client = new QueryClient();
        const rawOptions = Object.freeze({
          queryKey: ["immutable-raw", operation] as const,
          queryFn: async () => await Promise.resolve(11),
          staleTime: 0,
        });
        const rawSnapshot = { ...rawOptions };
        const rawResult = yield* queryEffects[operation](rawOptions).pipe(
          Effect.provideService(QueryClientService, client)
        );
        expect(rawResult).toBe(11);
        expect(rawOptions).toStrictEqual(rawSnapshot);

        const defaultedOptions = Object.freeze(
          client.defaultQueryOptions({
            queryKey: ["immutable-defaulted", operation] as const,
            queryFn: async () => await Promise.resolve(22),
            staleTime: 0,
          })
        );
        const defaultedSnapshot = { ...defaultedOptions };
        const defaultedResult = yield* queryEffects[operation](
          defaultedOptions
        ).pipe(Effect.provideService(QueryClientService, client));
        expect(defaultedResult).toBe(22);
        expect(defaultedOptions).toStrictEqual(defaultedSnapshot);
        client.clear();
      })
  );
}

it.effect("revalidates stale initial data inherited from query defaults", () =>
  Effect.gen(function* revalidatesInitialData() {
    const client = new QueryClient();
    const queryKey = ["default-initial-data"];
    client.setQueryDefaults(queryKey, { initialData: 1, staleTime: 0 });
    let executions = 0;
    const data = yield* queryEffects
      .ensure({
        queryKey,
        queryFn: async () => {
          executions += 1;
          return await Promise.resolve(2);
        },
        revalidateIfStale: true,
      })
      .pipe(Effect.provideService(QueryClientService, client));
    expect({ data, executions }).toStrictEqual({ data: 1, executions: 1 });
    client.clear();
  })
);

it.effect(
  "reports a staleTime callback failure while ensuring cached data",
  () =>
    Effect.gen(function* freshnessCallbackFailure() {
      const client = new QueryClient();
      const queryKey = ["freshness-callback-failure"];
      const cause = new Error("Cannot resolve freshness");
      client.setQueryData(queryKey, 1);
      try {
        const failure = yield* queryEffects
          .ensure<number>({
            queryKey,
            revalidateIfStale: true,
            staleTime: () => {
              throw cause;
            },
          })
          .pipe(Effect.flip, Effect.provideService(QueryClientService, client));
        expect(failure.cause).toBe(cause);
      } finally {
        client.clear();
      }
    })
);

it.effect(
  "preserves stale/fresh reuse semantics for fetch, ensure, and revalidateIfStale",
  () =>
    Effect.gen(function* cacheReuseSemantics() {
      const client = new QueryClient();
      let executions = 0;
      const options = {
        queryKey: ["cache-reuse"] as const,
        queryFn: async () => {
          executions += 1;
          return await Promise.resolve(executions);
        },
        select: (value: number) => `selected:${value}`,
      };

      const first = yield* queryEffects
        .fetch({ ...options, staleTime: Infinity })
        .pipe(Effect.provideService(QueryClientService, client));
      const freshFetch = yield* queryEffects
        .fetch({ ...options, staleTime: Infinity })
        .pipe(Effect.provideService(QueryClientService, client));
      const staleEnsure = yield* queryEffects
        .ensure({ ...options, staleTime: 0 })
        .pipe(Effect.provideService(QueryClientService, client));
      const staleFetch = yield* queryEffects
        .fetch({ ...options, staleTime: 0 })
        .pipe(Effect.provideService(QueryClientService, client));
      const revalidatedEnsure = yield* queryEffects
        .ensure({ ...options, staleTime: 0, revalidateIfStale: true })
        .pipe(Effect.provideService(QueryClientService, client));
      yield* waitForQueryState(
        client,
        () => client.getQueryData(options.queryKey) === 3
      );

      let coldExecutions = 0;
      const coldEnsure = yield* queryEffects
        .ensure({
          queryKey: ["cache-reuse-cold"] as const,
          queryFn: async () => {
            coldExecutions += 1;
            return await Promise.resolve(coldExecutions);
          },
          staleTime: 0,
          revalidateIfStale: true,
        })
        .pipe(Effect.provideService(QueryClientService, client));

      expect({
        first,
        freshFetch,
        staleEnsure,
        staleFetch,
        revalidatedEnsure,
        executions,
        coldEnsure,
        coldExecutions,
      }).toStrictEqual({
        first: 1,
        freshFetch: 1,
        staleEnsure: 1,
        staleFetch: 2,
        revalidatedEnsure: 2,
        executions: 3,
        coldEnsure: 1,
        coldExecutions: 1,
      });

      client.clear();
    })
);
