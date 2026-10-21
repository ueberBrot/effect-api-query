import { describe, it } from "@effect/vitest";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { Deferred, Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { expect } from "vite-plus/test";

import { createRpcQueryUtils } from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc.ts";
import { waitForQueryState } from "./fixtures/query-cache.ts";

it.effect(
  "normalizes live emissions while preserving accumulated undefined elements",
  () =>
    Effect.gen(function* normalizeStreamValues() {
      const group = RpcGroup.make(
        Rpc.make("watch", {
          success: Schema.UndefinedOr(Schema.NullOr(Schema.String)),
          stream: true,
        })
      );
      let values: readonly (string | null | undefined)[] = [];
      const client = yield* makeRpcTestClient(group, {
        watch: () => Stream.fromIterable(values),
      });
      const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["values"] });
      const queryClient = new QueryClient();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          queryClient.clear();
        })
      );
      for (const emissions of [
        [null],
        [undefined],
        ["first", undefined],
      ] as const) {
        values = emissions;
        const recorded: unknown[] = [];
        const options = rpc.watch.liveOptions();
        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
          if (event.type === "updated" && event.action.type === "success") {
            recorded.push(event.query.state.data);
          }
        });
        try {
          expect(
            yield* Effect.promise(async () => await queryClient.query(options))
          ).toBeNull();
          expect(queryClient.getQueryData(options.queryKey)).toBeNull();
          if (emissions.length === 2) {
            expect(recorded.slice(0, 2)).toStrictEqual(["first", null]);
          }
        } finally {
          unsubscribe();
        }
        expect(
          yield* Effect.promise(
            async () => await queryClient.query(rpc.watch.streamedOptions())
          )
        ).toStrictEqual(emissions);
        queryClient.clear();
      }
    })
);

describe.each(["global", "prefix"] as const)(
  "uses %s hashing for native reads, writes, and an open stream first publication",
  (mode) => {
    it.effect("shares native cache identity with stream publications", () =>
      Effect.gen(function* useConfiguredHashing() {
        const group = RpcGroup.make(
          Rpc.make("read", { success: Schema.String }),
          Rpc.make("watch", { success: Schema.Undefined, stream: true })
        );
        const finalized = yield* Deferred.make<boolean>();
        let closed = 0;
        const client = yield* makeRpcTestClient(group, {
          read: () => Effect.succeed("server"),
          watch: () =>
            Stream.fromIterable([undefined]).pipe(
              Stream.concat(Stream.never),
              Stream.ensuring(
                Effect.sync(() => {
                  closed += 1;
                }).pipe(
                  Effect.flatMap(() =>
                    closed === 2
                      ? Deferred.succeed(finalized, true)
                      : Effect.void
                  )
                )
              )
            ),
        });
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["hashing"],
        });
        const queryClient = new QueryClient({
          defaultOptions: {
            queries: {
              queryKeyHashFn: (key) => `global:${JSON.stringify(key)}`,
              retry: false,
              staleTime: Infinity,
            },
          },
        });
        if (mode === "prefix") {
          queryClient.setQueryDefaults(rpc.key(), {
            queryKeyHashFn: (key) => `prefix:${JSON.stringify(key)}`,
          });
        }
        const options = rpc.watch.liveOptions();
        const observer = new QueryObserver(queryClient, options);
        const unsubscribe = observer.subscribe(() => {});
        const history = new QueryObserver(
          queryClient,
          rpc.watch.streamedOptions()
        );
        const stopHistory = history.subscribe(() => {});
        try {
          yield* waitForQueryState(
            queryClient,
            () =>
              observer.getCurrentResult().status === "success" &&
              history.getCurrentResult().status === "success"
          );
          expect({
            live: {
              data: observer.getCurrentResult().data,
              fetchStatus: observer.getCurrentResult().fetchStatus,
            },
            liveCache: queryClient.getQueryData(rpc.watch.liveKey()),
            history: {
              data: history.getCurrentResult().data,
              fetchStatus: history.getCurrentResult().fetchStatus,
            },
            historyCache: queryClient.getQueryData(rpc.watch.streamedKey()),
          }).toStrictEqual({
            live: { data: null, fetchStatus: "fetching" },
            liveCache: null,
            history: { data: [undefined], fetchStatus: "fetching" },
            historyCache: [undefined],
          });
          queryClient.setQueryData(rpc.watch.liveKey(), null);
          queryClient.setQueryData(rpc.watch.streamedKey(), [
            undefined,
            undefined,
          ]);
          expect(
            queryClient.getQueryData(rpc.watch.streamedKey())
          ).toStrictEqual([undefined, undefined]);
          const serverRead = yield* Effect.promise(
            async () => await queryClient.query(rpc.read.queryOptions())
          );
          queryClient.setQueryData(rpc.read.queryKey(), "native");
          expect({
            server: serverRead,
            cached: yield* Effect.promise(
              async () => await queryClient.query(rpc.read.queryOptions())
            ),
          }).toStrictEqual({ server: "server", cached: "native" });
          const pages = rpc.read.infiniteOptions({
            initialPageParam: 0,
            getNextPageParam: () => {},
          });
          const serverPages = yield* Effect.promise(
            async () => await queryClient.infiniteQuery(pages)
          );
          queryClient.setQueryData(rpc.read.infiniteKey(), {
            pages: ["native"],
            pageParams: [0],
          });
          expect({
            server: serverPages,
            cached: yield* Effect.promise(
              async () => await queryClient.infiniteQuery(pages)
            ),
          }).toStrictEqual({
            server: { pages: ["server"], pageParams: [0] },
            cached: { pages: ["native"], pageParams: [0] },
          });
          const queries = queryClient.getQueryCache().getAll();
          expect({
            count: queries.length,
            hashesMatch: queries.every((query) =>
              query.queryHash.startsWith(`${mode}:`)
            ),
          }).toStrictEqual({ count: 4, hashesMatch: true });
        } finally {
          unsubscribe();
          stopHistory();
          yield* Effect.promise(async () => {
            await queryClient.cancelQueries();
          });
          yield* Deferred.await(finalized);
          queryClient.clear();
        }
      })
    );
  }
);

it.effect(
  "keeps concurrent retention views independent through completion",
  () =>
    Effect.gen(function* isolateRetentionViews() {
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      const release = yield* Deferred.make<boolean>();
      const client = yield* makeRpcTestClient(group, {
        watch: () =>
          Stream.make(1, 2, 3, 4).pipe(
            Stream.concat(
              Stream.fromEffect(Deferred.await(release).pipe(Effect.as(5)))
            )
          ),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["retention"],
      });
      const queryClient = new QueryClient();
      const narrow = new QueryObserver(
        queryClient,
        rpc.watch.streamedOptions({ maxChunks: 2 })
      );
      const wide = new QueryObserver(
        queryClient,
        rpc.watch.streamedOptions({ maxChunks: 4 })
      );
      const stopNarrow = narrow.subscribe(() => {});
      const stopWide = wide.subscribe(() => {});
      try {
        yield* waitForQueryState(
          queryClient,
          () =>
            narrow.getCurrentResult().data?.at(-1) === 4 &&
            wide.getCurrentResult().data?.at(-1) === 4
        );
        expect(narrow.getCurrentResult().data).toStrictEqual([3, 4]);
        expect(wide.getCurrentResult().data).toStrictEqual([1, 2, 3, 4]);
        yield* Deferred.succeed(release, true);
        yield* waitForQueryState(
          queryClient,
          () =>
            narrow.getCurrentResult().fetchStatus === "idle" &&
            wide.getCurrentResult().fetchStatus === "idle"
        );
        expect(narrow.getCurrentResult().data).toStrictEqual([4, 5]);
        expect(wide.getCurrentResult().data).toStrictEqual([2, 3, 4, 5]);
        expect(queryClient.getQueryCache().getAll()).toHaveLength(2);
      } finally {
        stopNarrow();
        stopWide();
        queryClient.clear();
      }
    })
);

describe.each([{ order: [4, 2] }, { order: [2, 4] }] as const)(
  "fetches retention views in order $order and invalidates exact versus broad policies",
  ({ order }) => {
    it.effect("invalidates exact and broader retention views", () =>
      Effect.gen(function* invalidateRetentionPolicies() {
        const group = RpcGroup.make(
          Rpc.make("watch", { success: Schema.Int, stream: true })
        );
        let calls = 0;
        const client = yield* makeRpcTestClient(group, {
          watch: () => {
            calls += 1;
            return Stream.make(1, 2, 3, 4);
          },
        });
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["retention-order"],
        });
        const queryClient = new QueryClient({
          defaultOptions: { queries: { staleTime: Infinity } },
        });
        try {
          for (const maxChunks of order) {
            expect(
              yield* Effect.promise(
                async () =>
                  await queryClient.query(
                    rpc.watch.streamedOptions({ maxChunks })
                  )
              )
            ).toStrictEqual(maxChunks === 2 ? [3, 4] : [1, 2, 3, 4]);
          }
          const narrow = rpc.watch.streamedKey({ maxChunks: 2 });
          const wide = rpc.watch.streamedKey({ maxChunks: 4 });
          const append = rpc.watch.streamedOptions({
            maxChunks: 2,
            refetchMode: "append",
          });
          yield* Effect.promise(async () => await queryClient.query(append));
          yield* Effect.promise(
            async () => await queryClient.query(rpc.watch.liveOptions())
          );
          queryClient.setQueryData(["unrelated"], 42);
          yield* Effect.promise(async () => {
            await queryClient.invalidateQueries({
              queryKey: narrow,
              exact: true,
              refetchType: "none",
            });
          });
          expect({
            narrow: queryClient.getQueryState(narrow)?.isInvalidated,
            wide: queryClient.getQueryState(wide)?.isInvalidated,
            append: queryClient.getQueryState(append.queryKey)?.isInvalidated,
          }).toStrictEqual({ narrow: true, wide: false, append: false });
          queryClient.setQueryData(narrow, [3, 4]);
          yield* Effect.promise(async () => {
            await queryClient.invalidateQueries({
              queryKey: [...rpc.watch.key(), "streamed"],
              refetchType: "none",
            });
          });
          expect({
            history: [narrow, wide, append.queryKey].map(
              (key) => queryClient.getQueryState(key)?.isInvalidated
            ),
            live: queryClient.getQueryState(rpc.watch.liveKey())?.isInvalidated,
          }).toStrictEqual({ history: [true, true, true], live: false });
          yield* Effect.promise(async () => {
            await queryClient.invalidateQueries({
              queryKey: rpc.watch.key(),
              refetchType: "none",
            });
          });
          expect({
            liveInvalidated: queryClient.getQueryState(rpc.watch.liveKey())
              ?.isInvalidated,
            unrelatedInvalidated: queryClient.getQueryState(["unrelated"])
              ?.isInvalidated,
            narrow: queryClient.getQueryData(narrow),
            wide: queryClient.getQueryData(wide),
            cacheEntries: queryClient.getQueryCache().getAll().length,
            calls,
          }).toStrictEqual({
            liveInvalidated: true,
            unrelatedInvalidated: false,
            narrow: [3, 4],
            wide: [1, 2, 3, 4],
            cacheEntries: 5,
            calls: 4,
          });
        } finally {
          queryClient.clear();
        }
      })
    );
  }
);
