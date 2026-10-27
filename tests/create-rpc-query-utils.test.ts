import { describe, expect, it } from "@effect/vitest";
import {
  MutationObserver,
  QueryClient,
  QueryObserver,
  skipToken as queryCoreSkipToken,
} from "@tanstack/query-core";
import { skipToken as reactQuerySkipToken } from "@tanstack/react-query";
import { Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

import { createRpcQueryUtils, skipToken } from "#effect-api-query";

import { group, makeClient, makeRpcTestClient } from "./fixtures/effect-rpc";

describe(createRpcQueryUtils, () => {
  it.effect(
    "preserves caller options while skipping a payload-bearing query",
    () =>
      Effect.gen(function* skipPayloadQuery() {
        const client = yield* makeClient();
        let executions = 0;
        const utils = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["app"] as const,
          runPromiseExit: async (effect, options) => {
            executions += 1;
            return await Effect.runPromiseExit(effect, options);
          },
        });
        const supplied = Object.freeze({
          input: skipToken,
          initialData: { id: 1, locale: "en", name: "Ada" },
          select: (user: { name: string }) => user.name,
          staleTime: 30_000,
          gcTime: 0,
          meta: { source: "conditional" },
          retry: false as const,
        });
        const options = utils.users.get.queryOptions(supplied);
        expect(options).toStrictEqual({
          initialData: supplied.initialData,
          select: supplied.select,
          staleTime: 30_000,
          gcTime: 0,
          meta: supplied.meta,
          retry: false,
          queryFn: queryCoreSkipToken,
          queryKey: ["app", "rpc", "users", "get", "query"],
        });
        const queryClient = new QueryClient();
        const observer = new QueryObserver(queryClient, options);
        const unsubscribe = observer.subscribe(() => {});
        yield* Effect.promise(async () => {
          await queryClient.invalidateQueries({ queryKey: utils.users.key() });
        });
        expect(observer.getCurrentResult()).toMatchObject({
          data: "Ada",
          fetchStatus: "idle",
        });
        expect(executions).toBe(0);
        unsubscribe();
        queryClient.clear();
      })
  );

  it.effect("creates frozen nested utilities and semantic keys", () =>
    Effect.gen(function* buildFrozenUtilityKeys() {
      const client = yield* makeClient();
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["app"] as const,
      });

      expect({
        root: utils.key(),
        branch: utils.users.key(),
        leaf: utils.users.get.key(),
        mutation: utils.users.get.mutationKey(),
        query: utils.users.get.queryKey({ id: 1 }),
        prototypeName: utils.toString.child.key(),
        stream: utils.events.watch.key(),
        streamed: utils.events.watch
          .streamedKey({ maxChunks: "unbounded" })
          .slice(0, 5),
        live: utils.events.watch.liveKey(),
      }).toStrictEqual({
        root: ["app", "rpc"],
        branch: ["app", "rpc", "users"],
        leaf: ["app", "rpc", "users", "get"],
        mutation: ["app", "rpc", "users", "get", "mutation"],
        query: ["app", "rpc", "users", "get", "query", { id: 1, locale: "en" }],
        prototypeName: ["app", "rpc", "toString", "child"],
        stream: ["app", "rpc", "events", "watch"],
        streamed: ["app", "rpc", "events", "watch", "streamed"],
        live: ["app", "rpc", "events", "watch", "live"],
      });
      expect({
        root: Object.isFrozen(utils),
        branch: Object.isFrozen(utils.users),
        queryKey: Object.isFrozen(utils.users.get.queryKey({ id: 1 })),
        payload: Object.isFrozen(utils.users.get.queryKey({ id: 1 }).at(-1)),
      }).toStrictEqual({
        root: true,
        branch: true,
        queryKey: true,
        payload: true,
      });
      const options = utils.users.get.queryOptions({ input: { id: 1 } });
      expect(options).not.toHaveProperty("queryKeyHashFn");
    })
  );

  it.effect("executes through Effect RPC and Query Core", () =>
    Effect.gen(function* executeQueryAndMutation() {
      const client = yield* makeClient();
      const queryClient = new QueryClient();
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["app"] as const,
      });

      const user = yield* Effect.promise(
        async () =>
          await queryClient.query(
            utils.users.get.queryOptions({ input: { id: 1 } })
          )
      );
      expect(user).toStrictEqual({ id: 1, locale: "en", name: "Ada" });

      const getMutation = new MutationObserver(
        queryClient,
        utils.users.get.mutationOptions()
      );
      const mutated = yield* Effect.promise(
        async () => await getMutation.mutate({ id: 2 })
      );
      expect(mutated).toStrictEqual({ id: 2, locale: "en", name: "Ada" });
    })
  );

  it.effect(
    "normalizes undefined queries and preserves undefined mutations",
    () =>
      Effect.gen(function* normalizeUndefinedQueryData() {
        const client = yield* makeClient();
        const queryClient = new QueryClient();
        const utils = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["app"] as const,
        });

        const queryResult = yield* Effect.promise(
          async () => await queryClient.query(utils.health.ping.queryOptions())
        );
        expect(queryResult).toBeNull();

        const mutation = new MutationObserver(
          queryClient,
          utils.health.ping.mutationOptions()
        );
        yield* Effect.promise(async () => {
          await expect(mutation.mutate()).resolves.toBeUndefined();
        });
      })
  );

  it.effect("reuses Query Core skipToken", () =>
    Effect.gen(function* reuseSkipToken() {
      const client = yield* makeClient();
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["app"] as const,
      });

      expect([queryCoreSkipToken, reactQuerySkipToken]).toStrictEqual([
        skipToken,
        skipToken,
      ]);
      const skipped = utils.users.get.queryOptions({ input: skipToken });
      expect(skipped).toMatchObject({
        queryFn: queryCoreSkipToken,
        queryKey: ["app", "rpc", "users", "get", "query"],
      });
      expect(skipped).not.toHaveProperty("queryKeyHashFn");

      const infiniteCallerOptions = {
        getNextPageParam: (): undefined => {},
        initialPageParam: 0,
        initialData: {
          pages: [{ id: 1, locale: "en", name: "Ada" }],
          pageParams: [0],
        },
        select: (data: { pages: readonly { name: string }[] }) =>
          data.pages[0]?.name,
        staleTime: 30_000,
        meta: { source: "conditional" },
      };
      const skippedInfinite = utils.users.get.infiniteOptions({
        ...infiniteCallerOptions,
        input: skipToken,
      });
      expect(skippedInfinite).toStrictEqual({
        ...infiniteCallerOptions,
        queryFn: queryCoreSkipToken,
        queryKey: ["app", "rpc", "users", "get", "infinite"],
      });
      expect(skippedInfinite).not.toHaveProperty("queryKeyHashFn");
    })
  );

  it.effect("projects ordinary reflected objects with literal RPC paths", () =>
    Effect.gen(function* reflectLiteralRpcPaths() {
      const Status = Rpc.make("status", { success: Schema.Void });
      const BracketOnly = Rpc.make("billing-history.list all", {
        success: Schema.Void,
      });
      const reflectedGroup = RpcGroup.make(Status, BracketOnly);
      const client = yield* makeRpcTestClient(reflectedGroup, {
        "billing-history.list all": () => Effect.void,
        status: () => Effect.void,
      });
      const utils = createRpcQueryUtils(reflectedGroup, {
        client,
        keyPrefix: ["app"] as const,
      });

      expect(Object.getPrototypeOf(utils)).toBe(Object.prototype);
      expect(Reflect.ownKeys(utils)).toStrictEqual([
        "key",
        "status",
        "billing-history",
      ]);
      expect(utils["billing-history"]["list all"].key()).toStrictEqual([
        "app",
        "rpc",
        "billing-history",
        "list all",
      ]);
      expect(
        yield* Effect.promise(async () => await Promise.resolve(utils))
      ).toBe(utils);
    })
  );

  it.effect(
    "freezes the owned tree without freezing fresh options or caller values",
    () =>
      Effect.gen(function* preserveOptionsOwnership() {
        const client = yield* makeClient();
        const utils = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["app"] as const,
        });
        const queryMeta = { source: "caller" };
        const infiniteMeta = { source: "infinite-caller" };
        const mutationMeta = { source: "caller" };

        const firstInfinite = utils.users.get.infiniteOptions({
          getNextPageParam: (): undefined => {},
          initialPageParam: 0,
          input: (id: number) => ({ id }),
          meta: infiniteMeta,
        });
        const secondInfinite = utils.users.get.infiniteOptions({
          getNextPageParam: (): undefined => {},
          initialPageParam: 0,
          input: (id: number) => ({ id }),
          meta: infiniteMeta,
        });
        const firstQuery = utils.users.get.queryOptions({
          input: { id: 1 },
          meta: queryMeta,
        });
        const secondQuery = utils.users.get.queryOptions({
          input: { id: 1 },
          meta: queryMeta,
        });
        const firstMutation = utils.users.get.mutationOptions({
          meta: mutationMeta,
        });
        const secondMutation = utils.users.get.mutationOptions({
          meta: mutationMeta,
        });

        expect({
          root: Object.isFrozen(utils),
          branch: Object.isFrozen(utils.users),
          leaf: Object.isFrozen(utils.users.get),
        }).toStrictEqual({ root: true, branch: true, leaf: true });
        for (const [first, second, meta] of [
          [firstInfinite, secondInfinite, infiniteMeta],
          [firstQuery, secondQuery, queryMeta],
          [firstMutation, secondMutation, mutationMeta],
        ] as const) {
          expect({
            fresh: first !== second,
            frozen: Object.isFrozen(first),
            retainsMeta: first.meta === meta,
            freezesMeta: Object.isFrozen(meta),
          }).toStrictEqual({
            fresh: true,
            frozen: false,
            retainsMeta: true,
            freezesMeta: false,
          });
        }
      })
  );

  it.effect(
    "projects mixed unary and streaming RPC paths with distinct view keys",
    () =>
      Effect.gen(function* projectMixedRpcViews() {
        const ListReports = Rpc.make("reports.list", {
          success: Schema.String,
        });
        const ReportsStream = Rpc.make("reports.watch", {
          success: Schema.String,
          stream: true,
        });
        const NestedStream = Rpc.make("events.audit.watch", {
          success: Schema.String,
          stream: true,
        });
        const RootStream = Rpc.make("updates.watch", {
          success: Schema.String,
          stream: true,
        });
        const mixedGroup = RpcGroup.make(
          ListReports,
          ReportsStream,
          NestedStream,
          RootStream
        );
        const client = yield* makeRpcTestClient(mixedGroup, {
          "events.audit.watch": () => Stream.empty,
          "reports.list": () => Effect.succeed("report"),
          "reports.watch": () => Stream.empty,
          "updates.watch": () => Stream.empty,
        });

        const utils = createRpcQueryUtils(mixedGroup, {
          client,
          keyPrefix: ["app"] as const,
        });

        expect(new Set(Object.keys(utils))).toStrictEqual(
          new Set(["events", "key", "reports", "updates"])
        );
        expect(new Set(Object.keys(utils.reports))).toStrictEqual(
          new Set(["key", "list", "watch"])
        );
        expect({
          unary: utils.reports.list.key(),
          nestedStreamed: utils.events.audit.watch
            .streamedKey({ maxChunks: "unbounded" })
            .slice(0, 6),
          nestedLive: utils.events.audit.watch.liveKey(),
          rootStreamed: utils.updates.watch
            .streamedKey({ maxChunks: "unbounded" })
            .slice(0, 5),
        }).toStrictEqual({
          unary: ["app", "rpc", "reports", "list"],
          nestedStreamed: [
            "app",
            "rpc",
            "events",
            "audit",
            "watch",
            "streamed",
          ],
          nestedLive: ["app", "rpc", "events", "audit", "watch", "live"],
          rootStreamed: ["app", "rpc", "updates", "watch", "streamed"],
        });
        expect(
          utils.events.audit.watch.streamedKey({ maxChunks: "unbounded" })
        ).not.toStrictEqual(utils.events.audit.watch.liveKey());
      })
  );
});
