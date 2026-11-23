import { it, expect } from "@effect/vitest";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { createRpcQueryUtils } from "@ueberbrot/effect-api-query";
import { Deferred, Effect, Stream } from "effect";

import { makeRpcTestClient } from "../../fixtures/effect-rpc";
import { waitForQueryState } from "../../fixtures/query-cache";
import { group } from "./fixture";
import { dashboard } from "./solution";

it.effect(
  "dashboard consumer preserves interception, view isolation, and a quiet-stream deadline",
  () =>
    Effect.gen(function* gradesDashboard() {
      const second = yield* Deferred.make<number>();
      const client = yield* makeRpcTestClient(group, {
        "users.read": () => Effect.succeed(7),
        "users.nested.read": () => Effect.succeed(8),
        "users.watch": () =>
          Stream.make(1).pipe(
            Stream.concat(Stream.fromEffect(Deferred.await(second))),
            Stream.concat(Stream.never)
          ),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["dashboard"],
      });
      const queryClient = new QueryClient();
      const calls: number[] = [];
      const result = dashboard(rpc, queryClient, (value) => {
        calls.push(value);
      });
      try {
        const value = yield* Effect.promise(
          async () => await queryClient.query(result.read.queryOptions())
        );
        queryClient.setQueryData(rpc.users.nested.read.queryKey(), 8);
        queryClient.setQueryData(rpc.users.watch.liveKey(), 9);
        yield* Effect.promise(async () => {
          await result.refresh();
        });
        expect({
          value,
          calls,
          defaults: result.read.queryOptions(),
          local: result.read.queryOptions({ staleTime: 10 }).staleTime,
          originalHasStaleTime: Object.hasOwn(
            rpc.users.read.queryOptions(),
            "staleTime"
          ),
        }).toMatchObject({
          value: 7,
          calls: [7],
          defaults: { staleTime: 1000 },
          local: 10,
          originalHasStaleTime: false,
        });
        expect(
          queryClient
            .getQueryCache()
            .findAll({ predicate: (query) => query.state.isInvalidated })
            .map((query) => query.queryKey)
        ).toStrictEqual([
          rpc.users.read.queryKey(),
          rpc.users.nested.read.queryKey(),
        ]);
        expect(result.watch.queryKey).toStrictEqual(
          rpc.users.watch.streamedKey({
            maxChunks: "unbounded",
            publicationBatchSize: 10,
            publicationMaxWaitMs: 50,
          })
        );
        const observer = new QueryObserver(queryClient, result.watch);
        const stop = observer.subscribe(() => {});
        try {
          const readWatch = () => observer.getCurrentResult();
          yield* waitForQueryState(queryClient, () => readWatch().isSuccess);
          expect(readWatch()).toMatchObject({
            data: [1],
            fetchStatus: "fetching",
          });
          yield* Deferred.succeed(second, 2);
          yield* waitForQueryState(
            queryClient,
            () => readWatch().data?.length === 2
          );
          expect(readWatch()).toMatchObject({
            data: [1, 2],
            fetchStatus: "fetching",
          });
        } finally {
          stop();
        }
      } finally {
        queryClient.clear();
      }
    })
);
