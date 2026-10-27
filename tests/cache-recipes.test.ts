import { User } from "@effect-api-query/contracts";
import { it } from "@effect/vitest";
import { MutationObserver, QueryClient } from "@tanstack/query-core";
import { Cause, Effect, Exit, Result, Schema, Scope, Stream } from "effect";
import { HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiTest,
} from "effect/http-api";
import { Reactivity } from "effect/reactivity";
import { Rpc, RpcGroup } from "effect/rpc";
import { describe, expect, it as test } from "vite-plus/test";

import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  isEffectHttpApiQueryError,
  isEffectRpcQueryError,
} from "#effect-api-query";
import type {
  EffectHttpApiQueryError,
  EffectRpcQueryError,
} from "#effect-api-query";

import { captureFailure } from "./fixtures/async.ts";
import { makeRpcTestClient } from "./fixtures/effect-rpc.ts";
import { makeControlledUserWrites } from "./fixtures/optimistic-users.ts";
import { makeUserEventConsumer } from "./fixtures/user-events.ts";
import { Profile } from "./types/docs-hydration-rich.ts";
import {
  Cursor,
  HistoryElement,
  prepareViewHydration,
  prepareViewSnapshot,
  ProfilePage,
  SnapshotDecoding,
  SnapshotEncoding,
} from "./types/docs-hydration-views.ts";

describe("cache recipes", () => {
  test("refreshes event cursors once and defers gaps until an overlapping write settles", async () => {
    const queryClient = new QueryClient();
    const fixture = await Effect.runPromise(
      makeControlledUserWrites(queryClient)
    );
    const scope = Scope.makeUnsafe();
    const reactivity = Effect.runSync(Reactivity.make);
    const { application } = fixture;
    const { rpcQuery, httpQuery } = application;
    const ada = new User({ id: 1, name: "Ada", locale: "en" });
    const key = rpcQuery.users.get.queryKey({ id: 1, locale: "en" });
    const diagnostic = rpcQuery.diagnostics.status.queryKey();
    fixture.seed([ada]);
    queryClient.setQueryData(key, ada);
    queryClient.setQueryData(diagnostic, { started: 0, interrupted: 0 });
    queryClient.setQueryData(rpcQuery.users.list.queryKey(), [ada]);
    queryClient.setQueryData(httpQuery.users.list.queryKey(), [ada]);
    let finish: (() => Promise<void>) | undefined;
    try {
      const consumer = await Effect.runPromise(
        makeUserEventConsumer(application, reactivity).pipe(
          Scope.provide(scope)
        )
      );
      const event = {
        schema: "users.v1",
        ownerKey: consumer.ownerKey,
        cursor: 1,
        kind: "user.changed",
        id: 1,
        locale: "en",
      } as const;
      const firstDelivery = await Effect.runPromise(consumer.deliver(event));
      await consumer.flush();
      expect({
        delivered: firstDelivery,
        invalidated: queryClient.getQueryState(key)?.isInvalidated,
      }).toStrictEqual({ delivered: true, invalidated: true });
      queryClient.setQueryData(key, ada);
      const duplicateDelivery = await Effect.runPromise(
        consumer.deliver(event)
      );
      await consumer.flush();
      expect({
        delivered: duplicateDelivery,
        invalidated: queryClient.getQueryState(key)?.isInvalidated,
      }).toStrictEqual({ delivered: false, invalidated: false });
      const mutation = new MutationObserver(
        queryClient,
        application.userWrites.rpcCreate()
      ).mutate({
        name: "Grace",
      });
      const creation = await fixture.nextCreate();
      finish = async () => {
        await creation.succeed(
          new User({ id: 2, name: "Grace", locale: "en" })
        );
        await mutation;
      };
      const gapDelivery = await Effect.runPromise(
        consumer.deliver({ ...event, cursor: 3 })
      );
      await consumer.flush();
      expect({
        delivered: gapDelivery,
        invalidated: queryClient.getQueryState(key)?.isInvalidated,
      }).toStrictEqual({ delivered: true, invalidated: false });
      await finish();
      await consumer.flush();
      expect({
        invalidated: queryClient.getQueryState(key)?.isInvalidated,
        diagnosticInvalidated:
          queryClient.getQueryState(diagnostic)?.isInvalidated,
        cursor: consumer.cursor(),
      }).toStrictEqual({
        invalidated: true,
        diagnosticInvalidated: false,
        cursor: 3,
      });
      const resumedCursor = await Effect.runPromise(consumer.resume(false));
      await consumer.flush();
      await Effect.runPromise(Scope.close(scope, Exit.void));
      queryClient.setQueryData(key, ada);
      reactivity.invalidateUnsafe([consumer.reactivityKeys.all]);
      await consumer.flush();
      const retiredDelivery = await Effect.runPromise(
        consumer.deliver({ ...event, cursor: 4 })
      );
      expect({
        resumedCursor,
        invalidated: queryClient.getQueryState(key)?.isInvalidated,
        delivered: retiredDelivery,
      }).toStrictEqual({
        resumedCursor: 0,
        invalidated: false,
        delivered: false,
      });
    } finally {
      await finish?.();
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await application.dispose();
    }
  });

  it.effect(
    "hydrates undefined history elements and rich infinite page parameters with paired codecs",
    () =>
      Effect.gen(function* hydratesStreamAndInfiniteViews() {
        const profile = new Profile({
          name: "Ada",
          credits: 9_007_199_254_740_993n,
          avatar: new Uint8Array([0, 1, 255]),
        });
        const group = RpcGroup.make(
          Rpc.make("watch", { success: HistoryElement, stream: true }),
          Rpc.make("latest", {
            success: Schema.UndefinedOr(Profile),
            stream: true,
          }),
          Rpc.make("page", {
            payload: { offset: Schema.BigIntFromString },
            success: ProfilePage,
          })
        );
        const client = yield* makeRpcTestClient(group, {
          watch: () => Stream.make(profile, undefined, null),
          latest: () => Stream.fromIterable([undefined]),
          page: () => Effect.succeed({ rows: [profile], next: null }),
        });
        const history = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["hydration-views", "history"],
        }).watch.streamedOptions({ maxChunks: "unbounded" });
        const infinite = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["hydration-views", "infinite"],
        }).page.infiniteOptions({
          initialPageParam: new Cursor({ offset: 0n }),
          input: (cursor) => ({ offset: cursor.offset }),
          getNextPageParam: () => {},
        });
        const latest = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["hydration-views", "live"],
        }).latest.liveOptions();
        const refreshed = new Profile({
          name: "Grace",
          credits: 42n,
          avatar: new Uint8Array([7]),
        });
        let browserReads = 0;
        const browserClient = yield* makeRpcTestClient(group, {
          watch: () => {
            browserReads += 1;
            return Stream.make(refreshed, undefined, null);
          },
          latest: () => {
            browserReads += 1;
            return Stream.succeed(refreshed);
          },
          page: () =>
            Effect.sync(() => {
              browserReads += 1;
              return { rows: [refreshed], next: null };
            }),
        });
        const browserHistory = createRpcQueryUtils(group, {
          client: browserClient,
          keyPrefix: ["hydration-views", "history"],
        }).watch.streamedOptions({ maxChunks: "unbounded" });
        const browserLatest = createRpcQueryUtils(group, {
          client: browserClient,
          keyPrefix: ["hydration-views", "live"],
        }).latest.liveOptions();
        const browserInfinite = createRpcQueryUtils(group, {
          client: browserClient,
          keyPrefix: ["hydration-views", "infinite"],
        }).page.infiniteOptions({
          initialPageParam: new Cursor({ offset: 0n }),
          input: (cursor) => ({ offset: cursor.offset }),
          getNextPageParam: () => {},
        });
        const server = new QueryClient();
        const browser = new QueryClient();
        try {
          yield* Effect.promise(async () => await server.query(history));
          yield* Effect.promise(
            async () => await server.infiniteQuery(infinite)
          );
          expect(
            yield* Effect.promise(async () => await server.query(latest))
          ).toBeNull();
          const json = yield* prepareViewSnapshot(server).pipe(
            Effect.provideService(SnapshotEncoding, {
              beforeEncode: Effect.void,
            })
          );
          yield* prepareViewHydration(browser, json).pipe(
            Effect.provideService(SnapshotDecoding, {
              beforeDecode: Effect.void,
            })
          );
          const restored = browser.getQueryData(history.queryKey);
          const first = restored?.[0];
          if (!(first instanceof Profile)) {
            throw new TypeError("Expected a decoded Profile");
          }
          const page = browser.getQueryData(infinite.queryKey);
          /* oxlint-disable typescript/no-unsafe-assignment */
          expect({
            history: restored,
            summary: first.summary(),
            avatar: first.avatar,
            cursor: page?.pageParams[0],
            atStart: page?.pageParams[0]?.isStart(),
            page: page?.pages[0]?.rows[0]?.summary(),
            latest: browser.getQueryData(browserLatest.queryKey),
            reads: browserReads,
          }).toStrictEqual({
            history: [expect.any(Profile), undefined, null],
            summary: "Ada: 9007199254740993 credits",
            avatar: new Uint8Array([0, 1, 255]),
            cursor: expect.any(Cursor),
            atStart: true,
            page: "Ada: 9007199254740993 credits",
            latest: null,
            reads: 0,
          });
          /* oxlint-enable typescript/no-unsafe-assignment */
          const newHistory = yield* Effect.promise(
            async () => await browser.query(browserHistory)
          );
          const newPages = yield* Effect.promise(
            async () => await browser.infiniteQuery(browserInfinite)
          );
          const newLatest = yield* Effect.promise(
            async () => await browser.query(browserLatest)
          );
          const [newFirst] = newHistory;
          if (
            !(newFirst instanceof Profile) ||
            !(newLatest instanceof Profile)
          ) {
            throw new TypeError("Expected browser-refetched Profile instances");
          }
          /* oxlint-disable typescript/no-unsafe-assignment */
          expect({
            history: newHistory,
            summary: newFirst.summary(),
            avatar: newFirst.avatar,
            cursor: newPages.pageParams[0],
            atStart: newPages.pageParams[0]?.isStart(),
            page: newPages.pages[0]?.rows[0]?.summary(),
            latest: newLatest.summary(),
            reads: browserReads,
          }).toStrictEqual({
            history: [expect.any(Profile), undefined, null],
            summary: "Grace: 42 credits",
            avatar: new Uint8Array([7]),
            cursor: expect.any(Cursor),
            atStart: true,
            page: "Grace: 42 credits",
            latest: "Grace: 42 credits",
            reads: 3,
          });
          /* oxlint-enable typescript/no-unsafe-assignment */
        } finally {
          server.clear();
          browser.clear();
        }
      })
  );
});

describe.each([
  "eventual-success",
  "retry-exhausted",
  "not-found",
  "disabled",
] as const)("native retry scenario %s", (scenario) => {
  it.effect("bounds generated RPC and HTTP query attempts for %s", () =>
    Effect.gen(function* boundsNativeQueryRetries() {
      const errors = Schema.Literals(["retry-later", "not-found"]);
      const failure: typeof errors.Type =
        scenario === "not-found" ? "not-found" : "retry-later";
      const failures = scenario === "eventual-success" ? 2 : Infinity;
      const group = RpcGroup.make(
        Rpc.make("read", { success: Schema.String, error: errors })
      );
      const api = HttpApi.make("retry-recipe").add(
        HttpApiGroup.make("items").add(
          HttpApiEndpoint.get("read", "/read", {
            success: Schema.String,
            error: errors,
          })
        )
      );
      const attempts = { rpc: 0, http: 0 };
      const read = (adapter: "rpc" | "http") =>
        Effect.suspend(() => {
          attempts[adapter] += 1;
          return attempts[adapter] <= failures
            ? Effect.fail(failure)
            : Effect.succeed("server");
        });
      const rpcClient = yield* makeRpcTestClient(group, {
        read: () => read("rpc"),
      });
      const httpClient = yield* HttpApiTest.groups(api, ["items"]).pipe(
        Effect.provide(
          HttpApiBuilder.group(api, "items", (handlers) =>
            handlers.handle("read", () => read("http"))
          )
        )
      );
      const rpc = createRpcQueryUtils(group, {
        client: rpcClient,
        keyPrefix: ["retry-rpc"],
      });
      const http = createHttpApiQueryUtils(api, {
        client: httpClient,
        keyPrefix: ["retry-http"],
      });
      for (const adapter of ["rpc", "http"] as const) {
        const retryCounts: number[] = [];
        const delayIndexes: number[] = [];
        const retry = (
          count: number,
          error: EffectRpcQueryError<unknown> | EffectHttpApiQueryError<unknown>
        ) => {
          retryCounts.push(count);
          if (
            (!isEffectRpcQueryError(error) &&
              !isEffectHttpApiQueryError(error)) ||
            count >= 2
          ) {
            return false;
          }
          const reason = Cause.findError(error.cause);
          return Result.isSuccess(reason) && reason.success === "retry-later";
        };
        const policy = {
          retry: scenario === "disabled" ? false : retry,
          retryDelay: (index: number) => {
            delayIndexes.push(index);
            return 0;
          },
        };
        const queryClient = new QueryClient();
        try {
          const result = yield* Effect.promise(
            async () =>
              await captureFailure(
                adapter === "rpc"
                  ? queryClient.query(rpc.read.queryOptions(policy))
                  : queryClient.query(http.items.read.queryOptions(policy))
              )
          );
          const expectedAttempts =
            scenario === "not-found" || scenario === "disabled" ? 1 : 3;
          expect(attempts[adapter]).toBe(expectedAttempts);
          const expectedCallbacks = {
            disabled: { retries: [], delays: [0] },
            "not-found": { retries: [0], delays: [0] },
            "eventual-success": { retries: [0, 1], delays: [0, 1] },
            "retry-exhausted": { retries: [0, 1, 2], delays: [0, 1, 2] },
          }[scenario];
          expect(retryCounts).toStrictEqual(expectedCallbacks.retries);
          expect(delayIndexes).toStrictEqual(expectedCallbacks.delays);
          if (scenario === "eventual-success") {
            expect(result).toBe("server");
          } else {
            expect(result).toMatchObject({
              _tag:
                adapter === "rpc"
                  ? "EffectRpcQueryError"
                  : "EffectHttpApiQueryError",
            });
          }
        } finally {
          queryClient.clear();
        }
      }
    }).pipe(Effect.provide(HttpServer.layerServices))
  );
});

it.effect(
  "merges global, registered and call-site defaults for native RPC and HTTP reads",
  () =>
    Effect.gen(function* mergesNativeQueryDefaults() {
      const group = RpcGroup.make(
        Rpc.make("users.read", {
          payload: { id: Schema.Int },
          success: Schema.String,
        })
      );
      const api = HttpApi.make("defaults-recipe").add(
        HttpApiGroup.make("users").add(
          HttpApiEndpoint.get("read", "/read/:id", {
            params: { id: Schema.Int },
            success: Schema.String,
          })
        )
      );
      const calls = { rpc: 0, http: 0 };
      const read = (adapter: "rpc" | "http") =>
        Effect.sync(() => {
          calls[adapter] += 1;
          return "server";
        });
      const rpcClient = yield* makeRpcTestClient(group, {
        "users.read": () => read("rpc"),
      });
      const httpClient = yield* HttpApiTest.groups(api, ["users"]).pipe(
        Effect.provide(
          HttpApiBuilder.group(api, "users", (handlers) =>
            handlers.handle("read", () => read("http"))
          )
        )
      );
      const rpc = createRpcQueryUtils(group, {
        client: rpcClient,
        keyPrefix: ["defaults-rpc"],
      });
      const http = createHttpApiQueryUtils(api, {
        client: httpClient,
        keyPrefix: ["defaults-http"],
      });
      for (const adapter of ["rpc", "http"] as const) {
        const queryClient = new QueryClient({
          defaultOptions: {
            queries: { staleTime: 30_000, gcTime: 600_000, retry: false },
          },
        });
        const rootKey = adapter === "rpc" ? rpc.key() : http.key();
        const branchKey =
          adapter === "rpc" ? rpc.users.key() : http.users.key();
        const leafKey =
          adapter === "rpc" ? rpc.users.read.key() : http.users.read.key();
        const key =
          adapter === "rpc"
            ? rpc.users.read.queryKey({ id: 1 })
            : http.users.read.queryKey({ params: { id: 1 } });
        queryClient.setQueryDefaults(rootKey, {
          staleTime: 60_000,
          queryKeyHashFn: (queryKey) => `defaults:${JSON.stringify(queryKey)}`,
        });
        queryClient.setQueryDefaults(branchKey, { retry: 2 });
        queryClient.setQueryDefaults([...leafKey, "query"], {
          staleTime: 120_000,
        });
        try {
          expect(
            yield* Effect.promise(async () =>
              adapter === "rpc"
                ? await queryClient.query(
                    rpc.users.read.queryOptions({ input: { id: 1 } })
                  )
                : await queryClient.query(
                    http.users.read.queryOptions({
                      input: { params: { id: 1 } },
                    })
                  )
            )
          ).toBe("server");
          expect(
            queryClient.getQueryCache().find({ queryKey: key, exact: true })
              ?.options
          ).toMatchObject({
            staleTime: 120_000,
            gcTime: 600_000,
            retry: 2,
          });
          queryClient.setQueryData(key, "native");
          const cached = yield* Effect.promise(async () =>
            adapter === "rpc"
              ? await queryClient.query(
                  rpc.users.read.queryOptions({ input: { id: 1 } })
                )
              : await queryClient.query(
                  http.users.read.queryOptions({
                    input: { params: { id: 1 } },
                  })
                )
          );
          expect({ data: cached, calls: calls[adapter] }).toStrictEqual({
            data: "native",
            calls: 1,
          });
          expect(
            yield* Effect.promise(async () =>
              adapter === "rpc"
                ? await queryClient.query(
                    rpc.users.read.queryOptions({
                      input: { id: 1 },
                      staleTime: 0,
                      retry: false,
                    })
                  )
                : await queryClient.query(
                    http.users.read.queryOptions({
                      input: { params: { id: 1 } },
                      staleTime: 0,
                      retry: false,
                    })
                  )
            )
          ).toBe("server");
          expect({
            options: queryClient
              .getQueryCache()
              .find({ queryKey: key, exact: true })?.options,
            calls: calls[adapter],
            data: queryClient.getQueryData(key),
            entries: queryClient.getQueryCache().getAll().length,
          }).toMatchObject({
            options: { staleTime: 0, gcTime: 600_000, retry: false },
            calls: 2,
            data: "server",
            entries: 1,
          });
        } finally {
          queryClient.clear();
        }
      }
    }).pipe(Effect.provide(HttpServer.layerServices))
);
