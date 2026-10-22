import { it, expect } from "@effect/vitest";
import { QueryClient } from "@tanstack/query-core";
import { createRpcQueryUtils } from "@ueberbrot/effect-api-query";
import { Effect, Stream } from "effect";

import { makeRpcTestClient } from "../../fixtures/effect-rpc";
import { group } from "./fixture";
import { dashboard } from "./solution";

it.effect(
  "dashboard consumer preserves interception, view isolation, and a quiet-stream deadline",
  () =>
    Effect.gen(function* gradesDashboard() {
      const client = yield* makeRpcTestClient(group, {
        "users.read": () => Effect.succeed(7),
        "users.nested.read": () => Effect.succeed(8),
        "users.watch": () => Stream.empty,
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
          original: rpc.users.read.queryOptions(),
        }).toMatchObject({
          value: 7,
          calls: [7],
          defaults: { staleTime: 1000 },
          local: 10,
        });
        expect(rpc.users.read.queryOptions()).not.toHaveProperty("staleTime");
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
            publicationBatchSize: 10,
            publicationMaxWaitMs: 50,
          })
        );
      } finally {
        queryClient.clear();
      }
    })
);
