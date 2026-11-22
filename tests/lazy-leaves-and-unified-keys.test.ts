import { types } from "node:util";

import { describe, expect, it } from "@effect/vitest";
import { Effect, Predicate, Schema, Stream } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  acquireQueryOwner,
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  prepareInput,
  skipToken,
} from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc";
import { makeUnusedHttpClient } from "./fixtures/http-client";

const rpcContract = RpcGroup.make(
  Rpc.make("users.get", {
    payload: { id: Schema.Int },
    success: Schema.String,
  }),
  Rpc.make("users.pages", {
    payload: { cursor: Schema.Int },
    success: Schema.Array(Schema.String),
  }),
  Rpc.make("health.ping", {
    success: Schema.Void,
  }),
  Rpc.make("events.watch", {
    payload: { channel: Schema.String },
    success: Schema.String,
    stream: true,
  }),
  Rpc.make("events.audit.watch", {
    success: Schema.String,
    stream: true,
  })
);

const makeContractRpcClient = () =>
  makeRpcTestClient(
    rpcContract,
    rpcContract.of({
      "users.get": ({ id }) => Effect.succeed(`user-${id}`),
      "users.pages": ({ cursor }) => Effect.succeed([`page-${cursor}`]),
      "health.ping": () => Effect.void,
      "events.watch": () => Stream.empty,
      "events.audit.watch": () => Stream.empty,
    })
  );

const httpContract = HttpApi.make("lazyHttp")
  .add(
    HttpApiGroup.make("items")
      .add(
        HttpApiEndpoint.get("get", "/items/:id", {
          params: { id: Schema.String },
          success: Schema.Struct({ id: Schema.String }),
        })
      )
      .add(
        HttpApiEndpoint.get("list", "/items", {
          success: Schema.Array(Schema.String),
        })
      )
      .add(
        HttpApiEndpoint.get("stream", "/items/:id/stream", {
          params: { id: Schema.String },
          success: HttpApiSchema.StreamSse({ data: Schema.String }),
        })
      )
      .add(
        HttpApiEndpoint.get("globalStream", "/items/stream", {
          success: HttpApiSchema.StreamSse({ data: Schema.String }),
        })
      )
  )
  .add(
    HttpApiGroup.make("health", { topLevel: true }).add(
      HttpApiEndpoint.get("ping", "/ping", {
        success: Schema.String,
      })
    )
  );

const isLazyLeafProperty = (
  target: { readonly key: () => readonly unknown[] },
  key: string
): boolean => {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor?.enumerable !== true || descriptor.configurable !== false) {
    return false;
  }
  // oxlint-disable-next-line typescript/unbound-method
  return Predicate.isFunction(descriptor.get);
};

const flatSuccessClient = () => Effect.succeed("ok");

describe("unified { input, ... } *Key builders", () => {
  it.effect(
    "matches *Options keys across RPC unary, infinite, live, and streamed leaves",
    () =>
      Effect.gen(function* verifyRpcUnifiedKeys() {
        const client = yield* makeContractRpcClient();
        const rpc = createRpcQueryUtils(rpcContract, {
          client,
          keyPrefix: ["unified"],
        });

        const preparedUser = prepareInput(rpc.users.get, { id: 7 });
        const preparedWatch = prepareInput(rpc.events.watch, {
          channel: "news",
        });

        expect({
          query: rpc.users.get.queryKey({ input: { id: 7 } }),
          preparedQuery: rpc.users.get.queryKey({ input: preparedUser }),
          infinite: rpc.users.pages.infiniteKey({ input: { cursor: 0 } }),
          live: rpc.events.watch.liveKey({ input: { channel: "news" } }),
          liveCoalesced: rpc.events.watch.liveKey({
            input: preparedWatch,
            coalesceMs: 50,
          }),
          streamed: rpc.events.watch.streamedKey({
            input: preparedWatch,
            maxChunks: 10,
            refetchMode: "append",
          }),
        }).toStrictEqual({
          query: rpc.users.get.queryOptions({ input: { id: 7 } }).queryKey,
          preparedQuery: rpc.users.get.queryOptions({ input: { id: 7 } })
            .queryKey,
          infinite: rpc.users.pages.infiniteOptions({
            input: (cursor: number) => ({ cursor }),
            initialPageParam: 0,
            getNextPageParam: () => null,
          }).queryKey,
          live: rpc.events.watch.liveOptions({ input: { channel: "news" } })
            .queryKey,
          liveCoalesced: rpc.events.watch.liveOptions({
            input: { channel: "news" },
            coalesceMs: 50,
          }).queryKey,
          streamed: rpc.events.watch.streamedOptions({
            input: { channel: "news" },
            maxChunks: 10,
            refetchMode: "append",
          }).queryKey,
        });

        expect({
          inputlessQuery: rpc.health.ping.queryKey(),
          inputlessInfinite: rpc.health.ping.infiniteKey(),
          inputlessLive: rpc.events.audit.watch.liveKey(),
          inputlessLiveCoalesced: rpc.events.audit.watch.liveKey({
            coalesceMs: 25,
          }),
          inputlessStreamed: rpc.events.audit.watch.streamedKey({
            maxChunks: "unbounded",
          }),
          leafKey: rpc.users.get.key(),
          mutationKey: rpc.users.get.mutationKey(),
        }).toStrictEqual({
          inputlessQuery: rpc.health.ping.queryOptions().queryKey,
          inputlessInfinite: rpc.health.ping.infiniteOptions({
            initialPageParam: 0,
            getNextPageParam: () => null,
          }).queryKey,
          inputlessLive: rpc.events.audit.watch.liveOptions().queryKey,
          inputlessLiveCoalesced: rpc.events.audit.watch.liveOptions({
            coalesceMs: 25,
          }).queryKey,
          inputlessStreamed: rpc.events.audit.watch.streamedOptions({
            maxChunks: "unbounded",
          }).queryKey,
          leafKey: ["unified", "rpc", "users", "get"],
          mutationKey: ["unified", "rpc", "users", "get", "mutation"],
        });
      })
  );

  it.effect(
    "matches *Options keys across HTTP unary, metadata, infinite, live, and streamed leaves",
    () =>
      Effect.gen(function* verifyHttpUnifiedKeys() {
        const client = yield* makeUnusedHttpClient(httpContract);
        const http = createHttpApiQueryUtils(httpContract, {
          client,
          keyPrefix: ["unified"],
        });

        const preparedGet = prepareInput(http.items.get, {
          params: { id: "a" },
        });
        const preparedStream = prepareInput(http.items.stream, {
          params: { id: "s1" },
        });

        expect({
          query: http.items.get.queryKey({ input: { params: { id: "a" } } }),
          preparedQuery: http.items.get.queryKey({ input: preparedGet }),
          metadata: http.items.get.metadataKey({ input: preparedGet }),
          infinite: http.items.get.infiniteKey({
            input: { params: { id: "a" } },
          }),
          live: http.items.stream.liveKey({
            input: preparedStream,
            coalesceMs: 40,
          }),
          streamed: http.items.stream.streamedKey({
            input: preparedStream,
            maxChunks: 5,
            refetchMode: "replace",
          }),
        }).toStrictEqual({
          query: http.items.get.queryOptions({ input: { params: { id: "a" } } })
            .queryKey,
          preparedQuery: http.items.get.queryOptions({
            input: { params: { id: "a" } },
          }).queryKey,
          metadata: http.items.get.metadataOptions({ input: preparedGet })
            .queryKey,
          infinite: http.items.get.infiniteOptions({
            input: (id: string) => ({ params: { id } }),
            initialPageParam: "a",
            getNextPageParam: () => null,
          }).queryKey,
          live: http.items.stream.liveOptions({
            input: { params: { id: "s1" } },
            coalesceMs: 40,
          }).queryKey,
          streamed: http.items.stream.streamedOptions({
            input: { params: { id: "s1" } },
            maxChunks: 5,
            refetchMode: "replace",
          }).queryKey,
        });

        expect({
          listQuery: http.items.list.queryKey(),
          listMetadata: http.items.list.metadataKey(),
          listInfinite: http.items.list.infiniteKey(),
          globalLive: http.items.globalStream.liveKey(),
          globalStreamed: http.items.globalStream.streamedKey({ maxChunks: 3 }),
          ping: http.ping.queryKey(),
        }).toStrictEqual({
          listQuery: http.items.list.queryOptions().queryKey,
          listMetadata: http.items.list.metadataOptions().queryKey,
          listInfinite: http.items.list.infiniteOptions({
            initialPageParam: 0,
            getNextPageParam: () => null,
          }).queryKey,
          globalLive: http.items.globalStream.liveOptions().queryKey,
          globalStreamed: http.items.globalStream.streamedOptions({
            maxChunks: 3,
          }).queryKey,
          ping: http.ping.queryOptions().queryKey,
        });
      })
  );

  it.effect(
    "rejects non-object arguments and skipToken at runtime on input-bearing *Key builders",
    () =>
      Effect.gen(function* rejectInvalidRuntimeKeyInputs() {
        const client = yield* makeContractRpcClient();
        const rpc = createRpcQueryUtils(rpcContract, { client });
        /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
        expect(() => rpc.users.get.queryKey(undefined as never)).toThrow(
          TypeError
        );
        expect(() => rpc.users.pages.infiniteKey(undefined as never)).toThrow(
          TypeError
        );
        expect(() => rpc.events.watch.streamedKey(undefined as never)).toThrow(
          TypeError
        );
        expect(() =>
          rpc.users.get.queryKey({ input: skipToken } as never)
        ).toThrow("Could not construct the payload for RPC users.get");
        expect(() =>
          rpc.events.watch.streamedKey({
            input: skipToken,
            maxChunks: 5,
          } as never)
        ).toThrow("Could not construct the payload for RPC events.watch");
        /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
      })
  );
});

describe("lazy-memoized frozen leaves", () => {
  it.effect(
    "returns plain frozen enumerable branches with lazy-memoized frozen leaves on RPC and HTTP trees",
    () =>
      Effect.gen(function* verifyLazyMemoizedLeaves() {
        const rpcClient = yield* makeContractRpcClient();
        const rpc = createRpcQueryUtils(rpcContract, { client: rpcClient });
        const httpClient = yield* makeUnusedHttpClient(httpContract);
        const http = createHttpApiQueryUtils(httpContract, {
          client: httpClient,
        });

        expect({
          rpcIsProxy: types.isProxy(rpc),
          rpcBranchIsProxy: types.isProxy(rpc.users),
          rpcFrozen: Object.isFrozen(rpc),
          rpcBranchFrozen: Object.isFrozen(rpc.users),
          rpcHasGet: Object.keys(rpc.users).includes("get"),
          rpcGetLazy: isLazyLeafProperty(rpc.users, "get"),
          httpIsProxy: types.isProxy(http),
          httpBranchIsProxy: types.isProxy(http.items),
          httpFrozen: Object.isFrozen(http),
          httpBranchFrozen: Object.isFrozen(http.items),
          httpHasPing: Object.keys(http).includes("ping"),
          httpHasGet: Object.keys(http.items).includes("get"),
          httpGetLazy: isLazyLeafProperty(http.items, "get"),
          httpPingLazy: isLazyLeafProperty(http, "ping"),
        }).toStrictEqual({
          rpcIsProxy: false,
          rpcBranchIsProxy: false,
          rpcFrozen: true,
          rpcBranchFrozen: true,
          rpcHasGet: true,
          rpcGetLazy: true,
          httpIsProxy: false,
          httpBranchIsProxy: false,
          httpFrozen: true,
          httpBranchFrozen: true,
          httpHasPing: true,
          httpHasGet: true,
          httpGetLazy: true,
          httpPingLazy: true,
        });

        const firstRpcLeaf = rpc.users.get;
        const firstHttpLeaf = http.items.get;
        const firstPingLeaf = http.ping;
        expect({
          rpcMemoized: firstRpcLeaf === rpc.users.get,
          rpcLeafFrozen: Object.isFrozen(firstRpcLeaf),
          httpMemoized: firstHttpLeaf === http.items.get,
          httpLeafFrozen: Object.isFrozen(firstHttpLeaf),
          pingMemoized: firstPingLeaf === http.ping,
          pingLeafFrozen: Object.isFrozen(firstPingLeaf),
        }).toStrictEqual({
          rpcMemoized: true,
          rpcLeafFrozen: true,
          httpMemoized: true,
          httpLeafFrozen: true,
          pingMemoized: true,
          pingLeafFrozen: true,
        });
      })
  );

  it.effect(
    "preserves leaf laziness and PreparedInput ownership through configureUtils and QueryOwner.trackUtils",
    () =>
      Effect.gen(function* verifyConfigureAndTrackLaziness() {
        const rpcClient = yield* makeContractRpcClient();
        const rpc = createRpcQueryUtils(rpcContract, { client: rpcClient });

        const configured = configureUtils(rpc, {
          query: { policy: { staleTime: 5000 } },
          streamed: { policy: { maxChunks: 20 } },
        });
        const sparseConfigured = configureUtils(rpc, {
          scoped: {
            users: {
              scoped: {
                get: { query: { policy: { staleTime: 1000 } } },
              },
            },
          },
        });

        const owner1 = yield* Effect.promise(
          async () =>
            await acquireQueryOwner(async () => await Promise.resolve({}))
        );
        const owner2 = yield* Effect.promise(
          async () =>
            await acquireQueryOwner(async () => await Promise.resolve({}))
        );
        try {
          const tracked = owner1.trackUtils(configured);
          const configuredAfterTrack = configureUtils(tracked, {
            query: { policy: { retry: false } },
          });

          expect({
            configuredFrozen: Object.isFrozen(configured),
            configuredBranchFrozen: Object.isFrozen(configured.users),
            configuredGetLazy: isLazyLeafProperty(configured.users, "get"),
            configuredWatchLazy: isLazyLeafProperty(configured.events, "watch"),
            sparseReusesUntouchedBranch: sparseConfigured.health === rpc.health,
            sparseGetLazy: isLazyLeafProperty(sparseConfigured.users, "get"),
            trackedFrozen: Object.isFrozen(tracked),
            trackedBranchFrozen: Object.isFrozen(tracked.users),
            trackedGetLazy: isLazyLeafProperty(tracked.users, "get"),
            trackedIdempotent: owner1.trackUtils(tracked) === tracked,
            configuredAfterTrackLazy: isLazyLeafProperty(
              configuredAfterTrack.users,
              "get"
            ),
          }).toStrictEqual({
            configuredFrozen: true,
            configuredBranchFrozen: true,
            configuredGetLazy: true,
            configuredWatchLazy: true,
            sparseReusesUntouchedBranch: true,
            sparseGetLazy: true,
            trackedFrozen: true,
            trackedBranchFrozen: true,
            trackedGetLazy: true,
            trackedIdempotent: true,
            configuredAfterTrackLazy: true,
          });

          expect(() => owner2.trackUtils(tracked)).toThrow(
            "Utility node is already tracked by another query owner"
          );
          expect(() => owner2.trackUtils(configuredAfterTrack)).toThrow(
            "Utility node is already tracked by another query owner"
          );

          const cachedRead = ["rpc", "users", "get", "query", { id: 9 }];
          owner1.queryClient.setQueryData(cachedRead, "user-9");
          const filteredTracked = owner1.queryClient.getQueriesData(
            tracked.queryFilter({ view: "query" })
          );
          const filteredConfigured = owner1.queryClient.getQueriesData(
            configuredAfterTrack.users.queryFilter({ view: "query" })
          );

          const firstTrackedLeaf = tracked.users.get;
          const prepared = prepareInput(firstTrackedLeaf, { id: 9 });
          expect({
            filteredTracked,
            filteredConfigured,
            filteredLeaf: configuredAfterTrack.users.get.queryFilter({
              view: "query",
              input: prepared,
            }).queryKey,
            rawMatchesTracked: rpc.users.get.queryKey({ input: prepared }),
            configuredMatchesTracked: configured.users.get.queryKey({
              input: prepared,
            }),
            configuredAfterTrackMatches:
              configuredAfterTrack.users.get.queryKey({ input: prepared }),
            streamedDefaultMatches: configured.events.watch.streamedKey({
              input: { channel: "ops" },
            }),
            trackedLeafMemoized: firstTrackedLeaf === tracked.users.get,
            trackedLeafFrozen: Object.isFrozen(firstTrackedLeaf),
          }).toStrictEqual({
            filteredTracked: [[cachedRead, "user-9"]],
            filteredConfigured: [[cachedRead, "user-9"]],
            filteredLeaf: cachedRead,
            rawMatchesTracked: tracked.users.get.queryKey({ input: prepared }),
            configuredMatchesTracked: tracked.users.get.queryKey({
              input: prepared,
            }),
            configuredAfterTrackMatches: tracked.users.get.queryKey({
              input: prepared,
            }),
            streamedDefaultMatches: rpc.events.watch.streamedKey({
              input: { channel: "ops" },
              maxChunks: 20,
            }),
            trackedLeafMemoized: true,
            trackedLeafFrozen: true,
          });
        } finally {
          yield* Effect.promise(async () => {
            await owner1.dispose();
            await owner2.dispose();
          });
        }
      })
  );

  it("validates paths, encoders, prefixes, and object-client methods eagerly even when leaves are lazy", () => {
    const collisionGroup = RpcGroup.make(
      Rpc.make("users", { success: Schema.String }),
      Rpc.make("users.get", { success: Schema.String })
    );
    expect(() =>
      createRpcQueryUtils(collisionGroup, {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion
        client: flatSuccessClient as never,
      })
    ).toThrow("collides with");

    const singleGroup = RpcGroup.make(
      Rpc.make("users.get", {
        payload: { id: Schema.String },
        success: Schema.String,
      })
    );
    expect(() =>
      createRpcQueryUtils(singleGroup, {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion
        client: {} as never,
      })
    ).toThrow("missing a function for tag users.get");
  });
});
