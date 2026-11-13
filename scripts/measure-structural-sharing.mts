import { performance } from "node:perf_hooks";

import { QueryClient } from "@tanstack/query-core";
import { Effect, Option } from "effect";
import { Rpc, RpcGroup, RpcTest } from "effect/rpc";

import { configureUtils, createRpcQueryUtils } from "#effect-api-query";

import {
  Reading,
  shareSnapshot,
  shareSnapshotRecipe,
  Snapshot,
} from "../tests/types/docs-structural-sharing.ts";

const snapshot = (records: number, version: number, changed: number) => ({
  revision: version,
  readings: Array.from(
    { length: records },
    (_, id) =>
      new Reading({
        id,
        observedAt: new Date("2026-01-01T00:00:00.000Z"),
        values: new Map([["temperature", id < changed ? version : 20]]),
        labels: new Set(["indoor"]),
        note: Option.some("calibrated"),
        attachment: null,
      })
  ),
});

const program = Effect.gen(function* () {
  const group = RpcGroup.make(Rpc.make("read", { success: Snapshot }));
  const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
    Effect.provide(
      group.toLayer({ read: () => Effect.succeed(snapshot(1, 0, 0)) })
    )
  );
  const rpc = createRpcQueryUtils(group, {
    client,
    keyPrefix: ["structural-sharing-measurement"],
  });
  const measurements = [];
  for (const records of [10, 1000]) {
    for (const workload of ["equal", "one-changed", "all-changed"] as const) {
      for (const policy of [
        "native",
        "recipe",
        "helper",
        "disabled",
      ] as const) {
        const queryClient = new QueryClient();
        const read = configureUtils(rpc.read, {
          query: {
            policy: {
              structuralSharing: {
                helper: shareSnapshot,
                recipe: shareSnapshotRecipe,
                native: true,
                disabled: false,
              }[policy],
            },
          },
        });
        const options = read.queryOptions();
        const changed = { equal: 0, "one-changed": 1, "all-changed": records }[
          workload
        ];
        const makeInput = (index: number) =>
          snapshot(records, workload === "equal" ? 0 : index, changed);
        try {
          yield* Effect.promise(async () => await queryClient.query(options));
          for (let index = 0; index < 20; index += 1) {
            queryClient.setQueryData(options.queryKey, makeInput(index));
          }
          const milliseconds = Array.from({ length: 5 }, () => {
            const inputs = Array.from({ length: 50 }, (_, index) =>
              makeInput(index)
            );
            const started = performance.now();
            for (const input of inputs) {
              queryClient.setQueryData(options.queryKey, input);
            }
            return performance.now() - started;
          });
          measurements.push({ records, workload, policy, milliseconds });
        } finally {
          queryClient.clear();
        }
      }
    }
  }
  console.log(
    JSON.stringify({
      samples: 5,
      iterations: 50,
      warmupIterations: 20,
      measurements,
    })
  );
});
await Effect.runPromise(program.pipe(Effect.scoped));
