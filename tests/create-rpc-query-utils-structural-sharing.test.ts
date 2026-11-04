import { expect, it } from "@effect/vitest";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { Effect, Option } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { describe } from "vite-plus/test";

import { configureUtils, createRpcQueryUtils } from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc";
import {
  Reading,
  shareSnapshot,
  Snapshot,
} from "./types/docs-structural-sharing";

const snapshot = (
  revision: number,
  changed = false,
  attachment: URL | null = null
) => ({
  revision,
  readings: [1, 2].map(
    (id) =>
      new Reading({
        id,
        observedAt: new Date("2026-01-01T00:00:00.000Z"),
        values: new Map([
          ["temperature", changed && id === 2 ? 21 : 20],
          ["humidity", 50],
        ]),
        labels: new Set(["indoor", "calibrated"]),
        note: Option.some("calibrated"),
        attachment,
      })
  ),
});

it.effect(
  "opts in to equivalent decoded records and nested reference reuse",
  () =>
    Effect.gen(function* shareDecodedRecords() {
      let next = snapshot(1);
      const group = RpcGroup.make(Rpc.make("read", { success: Snapshot }));
      const client = yield* makeRpcTestClient(group, {
        read: () => Effect.sync(() => next),
      });
      const base = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["sharing"],
      });
      const rpc = configureUtils(base, {
        scoped: {
          read: { query: { policy: { structuralSharing: shareSnapshot } } },
        },
      });
      const queryClient = new QueryClient();
      const observer = new QueryObserver(
        queryClient,
        rpc.read.queryOptions({
          enabled: false,
          select: (data) => data.readings[0],
        })
      );
      const stop = observer.subscribe(() => {});
      try {
        const first = yield* Effect.promise(
          async () => await queryClient.query(rpc.read.queryOptions())
        );
        next = snapshot(1);
        next.readings = next.readings.map(
          ({ id, observedAt, note, attachment }) =>
            new Reading({
              id,
              observedAt,
              values: new Map([
                ["humidity", 50],
                ["temperature", 20],
              ]),
              labels: new Set(["calibrated", "indoor"]),
              note,
              attachment,
            })
        );
        yield* Effect.promise(
          async () => await queryClient.query(rpc.read.queryOptions())
        );
        const equal = queryClient.getQueryData(rpc.read.queryKey());
        expect(equal).toBe(first);
        expect(observer.getCurrentResult().data).toBe(first.readings[0]);
        next = snapshot(2, true);
        yield* Effect.promise(
          async () => await queryClient.query(rpc.read.queryOptions())
        );
        const changed = queryClient.getQueryData(rpc.read.queryKey());
        expect({
          newSnapshot: changed !== first,
          sameFirst: changed?.readings[0] === first.readings[0],
          newSecond: changed?.readings[1] === next.readings[1],
          temperature: changed?.readings[1]?.values.get("temperature"),
          selectedFirst: observer.getCurrentResult().data === first.readings[0],
        }).toStrictEqual({
          newSnapshot: true,
          sameFirst: true,
          newSecond: true,
          temperature: 21,
          selectedFirst: true,
        });
        expect(rpc.read.queryKey()).toStrictEqual(base.read.queryKey());
      } finally {
        stop();
        queryClient.clear();
      }
    })
);

it.effect("leaves sharing opt-in and honors a local native override", () =>
  Effect.gen(function* preserveNativeDefaults() {
    const group = RpcGroup.make(Rpc.make("read", { success: Snapshot }));
    const client = yield* makeRpcTestClient(group, {
      read: () => Effect.sync(() => snapshot(1)),
    });
    const rpc = createRpcQueryUtils(group, {
      client,
      keyPrefix: ["sharing-defaults"],
    });
    const configured = configureUtils(rpc.read, {
      query: { policy: { structuralSharing: shareSnapshot } },
    });
    const queryClient = new QueryClient();
    try {
      const first = yield* Effect.promise(
        async () => await queryClient.query(rpc.read.queryOptions())
      );
      yield* Effect.promise(
        async () => await queryClient.query(rpc.read.queryOptions())
      );
      const native = queryClient.getQueryData(rpc.read.queryKey());
      expect(native?.readings[0]).not.toBe(first.readings[0]);
      yield* Effect.promise(
        async () =>
          await queryClient.query(
            configured.queryOptions({ structuralSharing: false })
          )
      );
      const unshared = queryClient.getQueryData(rpc.read.queryKey());
      expect(unshared?.readings[0]).not.toBe(native?.readings[0]);
    } finally {
      queryClient.clear();
    }
  })
);

describe.each([
  {
    name: "Date",
    fields: { observedAt: new Date("2026-01-02T00:00:00.000Z") },
  },
  { name: "Map", fields: { values: new Map([["temperature", 21]]) } },
  { name: "Set", fields: { labels: new Set(["outdoor"]) } },
  { name: "Option", fields: { note: Option.none<string>() } },
  {
    name: "custom value",
    fields: { attachment: new URL("https://example.test") },
  },
] as const)("keeps incoming records with a changed $name", ({ fields }) => {
  it.effect(
    "retains an unchanged neighbor and the changed incoming record",
    () =>
      Effect.gen(function* retainChangedRichValues() {
        const attachment =
          "attachment" in fields ? new URL("https://example.test") : null;
        let next = snapshot(1, false, attachment);
        const group = RpcGroup.make(Rpc.make("read", { success: Snapshot }));
        const client = yield* makeRpcTestClient(group, {
          read: () => Effect.sync(() => next),
        });
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["sharing-changes"],
        });
        const queryClient = new QueryClient();
        const options = rpc.read.queryOptions({
          structuralSharing: shareSnapshot,
        });
        try {
          const first = yield* Effect.promise(
            async () => await queryClient.query(options)
          );
          next = snapshot(1, false, attachment);
          const [, reading] = next.readings;
          if (reading === undefined) {
            throw new Error("Missing fixture reading");
          }
          next.readings[1] = new Reading({
            id: reading.id,
            observedAt: reading.observedAt,
            values: reading.values,
            labels: reading.labels,
            note: reading.note,
            attachment: reading.attachment,
            ...fields,
          });
          yield* Effect.promise(async () => await queryClient.query(options));
          const changed = queryClient.getQueryData(options.queryKey);
          expect(changed?.readings[0]).toBe(first.readings[0]);
          expect(changed?.readings[1]).toBe(next.readings[1]);
          expect(changed?.readings[1]).not.toBe(first.readings[1]);
        } finally {
          queryClient.clear();
        }
      })
  );
});
