import { it } from "@effect/vitest";
import { QueryClient } from "@tanstack/query-core";
import { Deferred, Effect, Exit, Schema, Scope, Stream } from "effect";
import { HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from "effect/http-api";
import { expect, vi } from "vite-plus/test";

import {
  createHttpApiQueryUtils,
  fetchStreamSnapshot,
} from "#effect-api-query";

import { Profile } from "./types/docs-hydration-rich.ts";
import {
  ArchivedProfile,
  HistoryElement,
  prepareViewHydration,
  prepareViewSnapshot,
  SnapshotDecoding,
  SnapshotEncoding,
} from "./types/docs-hydration-views.ts";

const trackSnapshotSubscriptions = (queryClient: QueryClient) => {
  const cache = queryClient.getQueryCache();
  const originalSubscribe = cache.subscribe.bind(cache);
  const subscribe = vi.spyOn(cache, "subscribe");
  return {
    subscribe,
    capture: () => {
      const callback = vi.fn<Parameters<typeof originalSubscribe>[0]>();
      const unsubscribe = vi.fn<() => void>();
      subscribe.mockImplementationOnce((listener) => {
        callback.mockImplementation(listener);
        unsubscribe.mockImplementation(originalSubscribe(callback));
        return unsubscribe;
      });
      return { callback, unsubscribe };
    },
  };
};

it.effect(
  "hydrates buffered and metadata views and refetches an alternate declared success",
  () =>
    Effect.gen(function* hydrateBufferedAndMetadataViews() {
      const api = HttpApi.make("hydration-metadata").add(
        HttpApiGroup.make("profiles").add(
          HttpApiEndpoint.get("read", "/read", {
            success: [
              HttpApiSchema.WithHeaders(Profile, {
                "x-version": Schema.FiniteFromString,
              }),
              HttpApiSchema.WithHeaders(ArchivedProfile, {
                "x-version": Schema.FiniteFromString,
              }).pipe(HttpApiSchema.status(203)),
            ],
          })
        )
      );
      const profile = new Profile({
        name: "Ada",
        credits: 9_007_199_254_740_993n,
        avatar: new Uint8Array([0, 1, 255]),
      });
      const archived = new ArchivedProfile({
        archived: true,
        name: "Grace",
        credits: 42n,
      });
      const serverScope = yield* Scope.make();
      const browserScope = yield* Scope.make();
      const server = new QueryClient();
      const browser = new QueryClient();
      const restored = new QueryClient();
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* closeBufferedHydrationResources() {
          server.clear();
          browser.clear();
          restored.clear();
          yield* Scope.close(serverScope, Exit.void);
          yield* Scope.close(browserScope, Exit.void);
        })
      );
      let serverReads = 0;
      let browserReads = 0;
      let encoded = 0;
      let decoded = 0;
      const encoding = {
        beforeEncode: Effect.sync(() => {
          encoded += 1;
        }),
      };
      const decoding = {
        beforeDecode: Effect.sync(() => {
          decoded += 1;
        }),
      };
      const serverClient = yield* HttpApiTest.groups(api, ["profiles"]).pipe(
        Effect.provide(
          HttpApiBuilder.group(api, "profiles", (handlers) =>
            handlers.handle("read", () =>
              Effect.sync(() => {
                serverReads += 1;
                return HttpApiSchema.withHeaders({
                  body: profile,
                  headers: { "x-version": 4 },
                });
              })
            )
          )
        ),
        Effect.provideService(Scope.Scope, serverScope)
      );
      const browserClient = yield* HttpApiTest.groups(api, ["profiles"]).pipe(
        Effect.provide(
          HttpApiBuilder.group(api, "profiles", (handlers) =>
            handlers.handle("read", () =>
              Effect.sync(() => {
                browserReads += 1;
                return HttpApiSchema.withHeaders({
                  body: archived,
                  headers: { "x-version": 7 },
                });
              })
            )
          )
        ),
        Effect.provideService(Scope.Scope, browserScope)
      );
      const serverOptions = createHttpApiQueryUtils(api, {
        client: serverClient,
        keyPrefix: ["hydration-views", "metadata"],
      }).profiles.read.metadataOptions({ retry: false, staleTime: Infinity });
      const browserOptions = createHttpApiQueryUtils(api, {
        client: browserClient,
        keyPrefix: ["hydration-views", "metadata"],
      }).profiles.read.metadataOptions({ retry: false, staleTime: Infinity });
      const serverBuffered = createHttpApiQueryUtils(api, {
        client: serverClient,
        keyPrefix: ["hydration-views", "buffered"],
      }).profiles.read.queryOptions({ retry: false, staleTime: Infinity });
      const browserBuffered = createHttpApiQueryUtils(api, {
        client: browserClient,
        keyPrefix: ["hydration-views", "buffered"],
      }).profiles.read.queryOptions({ retry: false, staleTime: Infinity });
      const initial = yield* Effect.promise(
        async () => await server.query(serverOptions)
      );
      yield* Effect.promise(async () => await server.query(serverBuffered));
      const json = yield* prepareViewSnapshot(server).pipe(
        Effect.provideService(SnapshotEncoding, encoding)
      );
      expect({
        cached: server.getQueryData(serverOptions.queryKey) === initial,
        profile: initial.data.body instanceof Profile,
        status: initial.status,
      }).toStrictEqual({
        cached: true,
        profile: true,
        status: 200,
      });
      server.clear();
      yield* Scope.close(serverScope, Exit.void);
      yield* prepareViewHydration(browser, json).pipe(
        Effect.provideService(SnapshotDecoding, decoding)
      );
      const hydrated = yield* Effect.promise(
        async () => await browser.query(browserOptions)
      );
      const hydratedBuffered = yield* Effect.promise(
        async () => await browser.query(browserBuffered)
      );
      if (!(hydratedBuffered.body instanceof Profile)) {
        throw new TypeError("Expected a hydrated buffered Profile");
      }
      if (!(hydrated.data.body instanceof Profile)) {
        throw new TypeError("Expected a hydrated Profile");
      }
      const expectedHydrated = HttpApiSchema.withHeaders({
        body: profile,
        headers: { "x-version": 4 },
      });
      expect({
        buffered: hydratedBuffered,
        metadata: hydrated.data,
        bufferedSummary: hydratedBuffered.body.summary(),
        metadataSummary: hydrated.data.body.summary(),
        bufferedAvatar: hydratedBuffered.body.avatar,
        metadataAvatar: hydrated.data.body.avatar,
        status: hydrated.status,
        rawVersion: hydrated.headers["x-version"],
        browserReads,
      }).toStrictEqual({
        buffered: expectedHydrated,
        metadata: expectedHydrated,
        bufferedSummary: "Ada: 9007199254740993 credits",
        metadataSummary: "Ada: 9007199254740993 credits",
        bufferedAvatar: new Uint8Array([0, 1, 255]),
        metadataAvatar: new Uint8Array([0, 1, 255]),
        status: 200,
        rawVersion: "4",
        browserReads: 0,
      });
      yield* Effect.promise(async () => {
        await browser.invalidateQueries({
          queryKey: browserOptions.queryKey,
          exact: true,
          refetchType: "none",
        });
        await browser.invalidateQueries({
          queryKey: browserBuffered.queryKey,
          exact: true,
          refetchType: "none",
        });
      });
      const refreshed = yield* Effect.promise(
        async () => await browser.query(browserOptions)
      );
      const refreshedBuffered = yield* Effect.promise(
        async () => await browser.query(browserBuffered)
      );
      expect({
        metadata: {
          archivedProfile: refreshed.data.body instanceof ArchivedProfile,
          summary: refreshed.data.body.summary(),
          decodedVersion: refreshed.data.headers["x-version"],
          status: refreshed.status,
          rawVersion: refreshed.headers["x-version"],
          frozen: Object.isFrozen(refreshed),
          headersFrozen: Object.isFrozen(refreshed.headers),
        },
        buffered: {
          archivedProfile: refreshedBuffered.body instanceof ArchivedProfile,
          summary: refreshedBuffered.body.summary(),
          decodedVersion: refreshedBuffered.headers["x-version"],
        },
      }).toStrictEqual({
        metadata: {
          archivedProfile: true,
          summary: "Grace: 42 archived credits",
          decodedVersion: 7,
          status: 203,
          rawVersion: "7",
          frozen: true,
          headersFrozen: true,
        },
        buffered: {
          archivedProfile: true,
          summary: "Grace: 42 archived credits",
          decodedVersion: 7,
        },
      });
      const refreshedJson = yield* prepareViewSnapshot(browser).pipe(
        Effect.provideService(SnapshotEncoding, encoding)
      );
      yield* prepareViewHydration(restored, refreshedJson).pipe(
        Effect.provideService(SnapshotDecoding, decoding)
      );
      const restoredMetadata = restored.getQueryData(browserOptions.queryKey);
      expect({
        data: restoredMetadata?.data,
        archivedProfile: restoredMetadata?.data.body instanceof ArchivedProfile,
        summary: restoredMetadata?.data.body.summary(),
        status: restoredMetadata?.status,
        rawVersion: restoredMetadata?.headers["x-version"],
        decodedVersion: restoredMetadata?.data.headers["x-version"],
      }).toStrictEqual({
        data: HttpApiSchema.withHeaders({
          body: archived,
          headers: { "x-version": 7 },
        }),
        archivedProfile: true,
        summary: "Grace: 42 archived credits",
        status: 203,
        rawVersion: "7",
        decodedVersion: 7,
      });
      expect([serverReads, browserReads, encoded, decoded]).toStrictEqual([
        2, 2, 4, 4,
      ]);
    }).pipe(Effect.provide(HttpServer.layerServices))
);

it.effect(
  "hydrates wrapped SSE live and history views with independent browser resources",
  () =>
    Effect.gen(function* hydrateWrappedSseViews() {
      const api = HttpApi.make("hydration-sse").add(
        HttpApiGroup.make("profiles").add(
          HttpApiEndpoint.get("watch", "/watch", {
            success: HttpApiSchema.WithHeaders(
              HttpApiSchema.StreamSse({ data: HistoryElement }),
              {
                "x-version": Schema.FiniteFromString,
              }
            ),
          })
        )
      );
      const profile = new Profile({
        name: "Ada",
        credits: 9_007_199_254_740_993n,
        avatar: new Uint8Array([0, 1, 255]),
      });
      const serverClosed = yield* Deferred.make<boolean>();
      const serverHistoryClosed = yield* Deferred.make<boolean>();
      const browserClosed = yield* Deferred.make<boolean>();
      const browserHistoryClosed = yield* Deferred.make<boolean>();
      const serverScope = yield* Scope.make();
      const browserScope = yield* Scope.make();
      const server = new QueryClient();
      const browser = new QueryClient();
      const restored = new QueryClient();
      const serverSubscriptions = trackSnapshotSubscriptions(server);
      const browserSubscriptions = trackSnapshotSubscriptions(browser);
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* closeStreamHydrationResources() {
          yield* Effect.promise(async () => {
            await server.cancelQueries();
            await browser.cancelQueries();
          });
          server.clear();
          browser.clear();
          restored.clear();
          expect({
            server: server.getQueryCache().hasListeners(),
            browser: browser.getQueryCache().hasListeners(),
            restored: restored.getQueryCache().hasListeners(),
          }).toStrictEqual({ server: false, browser: false, restored: false });
          serverSubscriptions.subscribe.mockRestore();
          browserSubscriptions.subscribe.mockRestore();
          yield* Scope.close(serverScope, Exit.void);
          yield* Scope.close(browserScope, Exit.void);
        })
      );
      let serverReads = 0;
      let browserReads = 0;
      const serverClient = yield* HttpApiTest.groups(api, ["profiles"]).pipe(
        Effect.provide(
          HttpApiBuilder.group(api, "profiles", (handlers) =>
            handlers.handle("watch", () =>
              Effect.sync(() => {
                serverReads += 1;
                return HttpApiSchema.withHeaders({
                  body: Stream.make(profile).pipe(
                    Stream.concat(Stream.never),
                    Stream.ensuring(
                      Deferred.succeed(
                        serverReads === 1 ? serverClosed : serverHistoryClosed,
                        true
                      )
                    )
                  ),
                  headers: { "x-version": 4 },
                });
              })
            )
          )
        ),
        Effect.provideService(Scope.Scope, serverScope)
      );
      const browserClient = yield* HttpApiTest.groups(api, ["profiles"]).pipe(
        Effect.provide(
          HttpApiBuilder.group(api, "profiles", (handlers) =>
            handlers.handle("watch", () =>
              Effect.sync(() => {
                browserReads += 1;
                return HttpApiSchema.withHeaders({
                  body: Stream.fromIterable([undefined]).pipe(
                    Stream.concat(Stream.never),
                    Stream.ensuring(
                      Deferred.succeed(
                        browserReads === 1
                          ? browserClosed
                          : browserHistoryClosed,
                        true
                      )
                    )
                  ),
                  headers: { "x-version": 7 },
                });
              })
            )
          )
        ),
        Effect.provideService(Scope.Scope, browserScope)
      );
      const serverOptions = createHttpApiQueryUtils(api, {
        client: serverClient,
        keyPrefix: ["hydration-views", "wrapped-live"],
      }).profiles.watch.liveOptions({ retry: false });
      const browserOptions = createHttpApiQueryUtils(api, {
        client: browserClient,
        keyPrefix: ["hydration-views", "wrapped-live"],
      }).profiles.watch.liveOptions({ retry: false });
      const serverHistory = createHttpApiQueryUtils(api, {
        client: serverClient,
        keyPrefix: ["hydration-views", "wrapped-history"],
      }).profiles.watch.streamedOptions({
        maxChunks: "unbounded",
        retry: false,
      });
      const browserHistory = createHttpApiQueryUtils(api, {
        client: browserClient,
        keyPrefix: ["hydration-views", "wrapped-history"],
      }).profiles.watch.streamedOptions({
        maxChunks: "unbounded",
        retry: false,
      });
      const serverLiveCapture = serverSubscriptions.capture();
      const initial = yield* Effect.promise(
        async () => await fetchStreamSnapshot(server, serverOptions)
      );
      const serverLiveState = {
        closed: Deferred.isDoneUnsafe(serverClosed),
        unsubscribeCalls: serverLiveCapture.unsubscribe.mock.calls.length,
        fetching: server.isFetching(),
      };
      serverLiveCapture.callback.mockClear();
      server.setQueryData(serverOptions.queryKey, initial);
      const serverLiveNotifications =
        serverLiveCapture.callback.mock.calls.length;
      const serverHistoryCapture = serverSubscriptions.capture();
      const initialHistory = yield* Effect.promise(
        async () => await fetchStreamSnapshot(server, serverHistory)
      );
      const serverHistoryState = {
        closed: Deferred.isDoneUnsafe(serverHistoryClosed),
        unsubscribeCalls: serverHistoryCapture.unsubscribe.mock.calls.length,
        fetching: server.isFetching(),
      };
      serverHistoryCapture.callback.mockClear();
      server.setQueryData(serverHistory.queryKey, initialHistory);
      expect({
        live: {
          ...serverLiveState,
          notificationsAfterWrite: serverLiveNotifications,
          profile: initial.body instanceof Profile,
          version: initial.headers["x-version"],
        },
        history: {
          ...serverHistoryState,
          notificationsAfterWrite:
            serverHistoryCapture.callback.mock.calls.length,
          data: initialHistory,
        },
      }).toStrictEqual({
        live: {
          closed: true,
          unsubscribeCalls: 1,
          fetching: 0,
          notificationsAfterWrite: 0,
          profile: true,
          version: 4,
        },
        history: {
          closed: true,
          unsubscribeCalls: 1,
          fetching: 0,
          notificationsAfterWrite: 0,
          data: [initial],
        },
      });
      const json = yield* prepareViewSnapshot(server).pipe(
        Effect.provideService(SnapshotEncoding, { beforeEncode: Effect.void })
      );
      const serverSnapshotUnchanged =
        server.getQueryData(serverOptions.queryKey) === initial;
      server.clear();
      const serverListenersAfterClear = server.getQueryCache().hasListeners();
      yield* Scope.close(serverScope, Exit.void);
      expect({
        serverSnapshotUnchanged,
        serverListenersAfterClear,
        browserClosed: Deferred.isDoneUnsafe(browserClosed),
      }).toStrictEqual({
        serverSnapshotUnchanged: true,
        serverListenersAfterClear: false,
        browserClosed: false,
      });
      yield* prepareViewHydration(browser, json).pipe(
        Effect.provideService(SnapshotDecoding, { beforeDecode: Effect.void })
      );
      browserSubscriptions.subscribe.mockClear();
      const hydrated = yield* Effect.promise(
        async () =>
          await fetchStreamSnapshot(browser, browserOptions, { mode: "cached" })
      );
      if (!(hydrated.body instanceof Profile)) {
        throw new TypeError("Expected a hydrated Profile");
      }
      const hydratedHistory = yield* Effect.promise(
        async () =>
          await fetchStreamSnapshot(browser, browserHistory, { mode: "cached" })
      );
      expect({
        live: hydrated,
        history: hydratedHistory,
        summary: hydrated.body.summary(),
        avatar: hydrated.body.avatar,
        subscriptions: browserSubscriptions.subscribe.mock.calls.length,
        browserReads,
      }).toStrictEqual({
        live: HttpApiSchema.withHeaders({
          body: profile,
          headers: { "x-version": 4 },
        }),
        history: [hydrated],
        summary: "Ada: 9007199254740993 credits",
        avatar: new Uint8Array([0, 1, 255]),
        subscriptions: 0,
        browserReads: 0,
      });
      const browserLiveCapture = browserSubscriptions.capture();
      const fresh = yield* Effect.promise(
        async () => await fetchStreamSnapshot(browser, browserOptions)
      );
      const browserLiveState = {
        closed: Deferred.isDoneUnsafe(browserClosed),
        unsubscribeCalls: browserLiveCapture.unsubscribe.mock.calls.length,
        fetching: browser.isFetching(),
      };
      browserLiveCapture.callback.mockClear();
      browser.setQueryData(browserOptions.queryKey, fresh);
      const browserLiveNotifications =
        browserLiveCapture.callback.mock.calls.length;
      const browserHistoryCapture = browserSubscriptions.capture();
      const freshHistory = yield* Effect.promise(
        async () => await fetchStreamSnapshot(browser, browserHistory)
      );
      const browserHistoryState = {
        closed: Deferred.isDoneUnsafe(browserHistoryClosed),
        unsubscribeCalls: browserHistoryCapture.unsubscribe.mock.calls.length,
        fetching: browser.isFetching(),
      };
      browserHistoryCapture.callback.mockClear();
      browser.setQueryData(browserHistory.queryKey, freshHistory);
      expect({
        live: {
          ...browserLiveState,
          notificationsAfterWrite: browserLiveNotifications,
          data: fresh,
        },
        history: {
          ...browserHistoryState,
          notificationsAfterWrite:
            browserHistoryCapture.callback.mock.calls.length,
          data: freshHistory,
        },
      }).toStrictEqual({
        live: {
          closed: true,
          unsubscribeCalls: 1,
          fetching: 0,
          notificationsAfterWrite: 0,
          data: HttpApiSchema.withHeaders({
            body: undefined,
            headers: { "x-version": 7 },
          }),
        },
        history: {
          closed: true,
          unsubscribeCalls: 1,
          fetching: 0,
          notificationsAfterWrite: 0,
          data: [fresh],
        },
      });
      const freshJson = yield* prepareViewSnapshot(browser).pipe(
        Effect.provideService(SnapshotEncoding, { beforeEncode: Effect.void })
      );
      yield* prepareViewHydration(restored, freshJson).pipe(
        Effect.provideService(SnapshotDecoding, { beforeDecode: Effect.void })
      );
      const restoredSnapshot = restored.getQueryData(browserOptions.queryKey);
      expect({
        live: restoredSnapshot,
        hasBody: Object.hasOwn(restoredSnapshot ?? {}, "body"),
        history: restored.getQueryData(browserHistory.queryKey),
        serverReads,
        browserReads,
        serverFetching: server.isFetching(),
        browserFetching: browser.isFetching(),
        serverHasListeners: server.getQueryCache().hasListeners(),
      }).toStrictEqual({
        live: HttpApiSchema.withHeaders({
          body: undefined,
          headers: { "x-version": 7 },
        }),
        hasBody: true,
        history: [fresh],
        serverReads: 2,
        browserReads: 2,
        serverFetching: 0,
        browserFetching: 0,
        serverHasListeners: false,
      });
    }).pipe(Effect.provide(HttpServer.layerServices))
);
