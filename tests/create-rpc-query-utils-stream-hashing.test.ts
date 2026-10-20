/* oxlint-disable vitest/no-standalone-expect */
import { describe, it } from "@effect/vitest";
import {
  experimental_streamedQuery,
  hashKey,
  QueryClient,
  QueryObserver,
} from "@tanstack/query-core";
import type { QueryFunction, QueryKey } from "@tanstack/query-core";
import { Effect, Predicate, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import { expect, vi } from "vite-plus/test";

import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
} from "#effect-api-query";

import { captureFailure } from "./fixtures/async";
import { makeRpcTestClient } from "./fixtures/effect-rpc.ts";

const cases = (["global", "prefix"] as const).flatMap((hashing) =>
  (["native", "custom"] as const).flatMap((initialHash) =>
    (["earlier", "later"] as const).flatMap((order) =>
      (["reset", "append", "replace", "live"] as const).map((view) => ({
        hashing,
        initialHash,
        order,
        view,
      }))
    )
  )
);

const verifyHashGuard = Effect.fnUntraced(function* verifyHashGuard<Data>(
  options: {
    readonly queryKey: QueryKey;
    readonly queryFn: QueryFunction<Data>;
  },
  historicalData: Data,
  currentData: Data,
  expectedData: Data,
  hashing: "global" | "prefix",
  initialHash: "native" | "custom",
  order: "earlier" | "later",
  identity: Readonly<Record<string, string>>,
  executions: () => number
) {
  const initialDefaults = {
    retry: false as const,
    ...(initialHash === "custom"
      ? { queryKeyHashFn: (key: QueryKey) => `old:${JSON.stringify(key)}` }
      : undefined),
  };
  const defaults = {
    retry: false as const,
    queryKeyHashFn: (key: QueryKey) => `new:${JSON.stringify(key)}`,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: initialDefaults },
  });
  if (order === "later") {
    queryClient.setDefaultOptions({ queries: defaults });
    queryClient.setQueryData(options.queryKey, currentData);
    queryClient.setDefaultOptions({ queries: initialDefaults });
  }
  queryClient.setQueryData(options.queryKey, historicalData);
  const observer = new QueryObserver(queryClient, {
    ...options,
    enabled: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  const historical = observer.getCurrentQuery();
  const historicalState = { ...historical.state };
  if (hashing === "global") {
    queryClient.setDefaultOptions({ queries: defaults });
  } else {
    queryClient.setQueryDefaults(options.queryKey, defaults);
  }
  try {
    yield* Effect.promise(async () => {
      await expect(queryClient.query(options)).rejects.toMatchObject({
        ...identity,
        code: "UnsupportedQueryHash",
      });
    });
    expect({
      historical: historical.state,
      executions: executions(),
    }).toStrictEqual({ historical: historicalState, executions: 0 });
    queryClient.setQueryData(options.queryKey, currentData);
    const current = queryClient
      .getQueryCache()
      .get(defaults.queryKeyHashFn(options.queryKey));
    const currentState = { ...current?.state };
    yield* Effect.promise(async () => {
      await expect(
        observer.refetch({ throwOnError: true })
      ).rejects.toMatchObject({
        ...identity,
        code: "UnsupportedQueryHash",
      });
    });
    expect({
      current: current?.state,
      historicalData: historical.state.data,
      historicalFetchStatus: historical.state.fetchStatus,
      executions: executions(),
    }).toStrictEqual({
      current: currentState,
      historicalData,
      historicalFetchStatus: "idle",
      executions: 0,
    });
    unsubscribe();
    queryClient.getQueryCache().remove(historical);
    expect({
      data: yield* Effect.promise(async () => await queryClient.query(options)),
      executions: executions(),
    }).toStrictEqual({ data: expectedData, executions: 1 });
  } finally {
    unsubscribe();
    yield* Effect.promise(async () => {
      await queryClient.cancelQueries();
    });
    queryClient.clear();
  }
});

describe.each(cases)(
  "rejects $initialHash to $hashing hash changes with $order history in RPC $view streams",
  ({ hashing, initialHash, order, view }) => {
    it.effect("guards cache identity before executing RPC streams", () =>
      Effect.gen(function* rejectRpcHashChanges() {
        expect.assertions(5);
        const group = RpcGroup.make(
          Rpc.make("watch", { success: Schema.Int, stream: true })
        );
        let executions = 0;
        const client = yield* makeRpcTestClient(group, {
          watch: () => {
            executions += 1;
            return Stream.succeed(2);
          },
        });
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["stream-hashing"],
        });
        const identity = { _tag: "EffectRpcQueryConfigError", rpcTag: "watch" };
        const verification =
          view === "live"
            ? verifyHashGuard(
                rpc.watch.liveOptions(),
                1,
                3,
                2,
                hashing,
                initialHash,
                order,
                identity,
                () => executions
              )
            : verifyHashGuard(
                rpc.watch.streamedOptions({ refetchMode: view }),
                [1],
                [3],
                view === "append" ? [3, 2] : [2],
                hashing,
                initialHash,
                order,
                identity,
                () => executions
              );
        yield* verification;
      })
    );
  }
);

const foreignCases = (["rpc", "http"] as const).flatMap((adapter) =>
  (["family", "constant", "bigint", "cycle"] as const).flatMap((foreign) =>
    (["reset", "append", "replace", "live"] as const).map((view) => ({
      adapter,
      foreign,
      view,
    }))
  )
);

interface ForeignCycle {
  self?: ForeignCycle;
}

const nativeStreamFn = () => Stream.toAsyncIterable(Stream.succeed(2));

const verifyForeignHash = Effect.fnUntraced(function* verifyForeignHash<Data>(
  options: {
    readonly queryKey: QueryKey;
    readonly queryFn: QueryFunction<Data>;
  },
  nativeQueryFn: QueryFunction<Data>,
  initialData: Data,
  expectedData: Data,
  foreign: "family" | "constant" | "bigint" | "cycle"
) {
  const results: Data[] = [];
  for (const queryFn of [options.queryFn, nativeQueryFn]) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(options.queryKey, initialData);
    queryClient.setQueryDefaults(["foreign"], {
      queryKeyHashFn: (key) => {
        if (foreign !== "family") {
          return "foreign:constant";
        }
        const [, input] = key;
        if (!Predicate.isObject(input) || !Predicate.isNumber(input["id"])) {
          throw new TypeError("Foreign keys require an id");
        }
        return `foreign:${input["id"]}`;
      },
    });
    const cycle: ForeignCycle = {};
    cycle.self = cycle;
    const objectInput = foreign === "cycle" ? cycle : { id: 1 };
    const foreignKey = ["foreign", foreign === "bigint" ? 1n : objectInput];
    queryClient.setQueryData(foreignKey, "foreign data");
    const foreignQuery = queryClient
      .getQueryCache()
      .get(foreign === "family" ? "foreign:1" : "foreign:constant");
    const foreignState = { ...foreignQuery?.state };
    try {
      const result = yield* Effect.promise(
        async () => await queryClient.query({ ...options, queryFn })
      );
      results.push(result);
      expect(result).toStrictEqual(expectedData);
      expect(foreignQuery?.state).toStrictEqual(foreignState);
    } finally {
      queryClient.clear();
    }
  }
  expect(results[0]).toStrictEqual(results[1]);
});

describe.each(foreignCases)(
  "preserves native $adapter $view behavior with a later $foreign foreign hasher",
  ({ adapter, foreign, view }) => {
    it.effect("matches native results and preserves foreign query state", () =>
      Effect.gen(function* preserveForeignHashBehavior() {
        expect.assertions(5);
        const group = RpcGroup.make(
          Rpc.make("watch", { success: Schema.Int, stream: true })
        );
        const rpcClient = yield* makeRpcTestClient(group, {
          watch: () => Stream.succeed(2),
        });
        const rpc = createRpcQueryUtils(group, {
          client: rpcClient,
          keyPrefix: ["stream-hashing"],
        });
        const api = HttpApi.make("stream-hashing").add(
          HttpApiGroup.make("events").add(
            HttpApiEndpoint.get("watch", "/watch", {
              success: HttpApiSchema.StreamSse({ data: Schema.Int }),
            })
          )
        );
        const httpClient = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response("data: 2\n\n", {
                  headers: { "content-type": "text/event-stream" },
                })
              )
            )
          ),
        });
        const http = createHttpApiQueryUtils(api, {
          client: httpClient,
          keyPrefix: ["stream-hashing"],
        });
        const verification =
          view === "live"
            ? verifyForeignHash(
                adapter === "rpc"
                  ? rpc.watch.liveOptions()
                  : http.events.watch.liveOptions(),
                experimental_streamedQuery({
                  initialValue: 0,
                  reducer: (_previous, value: number) => value,
                  streamFn: nativeStreamFn,
                }),
                1,
                2,
                foreign
              )
            : verifyForeignHash(
                adapter === "rpc"
                  ? rpc.watch.streamedOptions({ refetchMode: view })
                  : http.events.watch.streamedOptions({ refetchMode: view }),
                experimental_streamedQuery({
                  refetchMode: view,
                  streamFn: nativeStreamFn,
                }),
                [1],
                view === "append" ? [1, 2] : [2],
                foreign
              );
        yield* verification;
      })
    );
  }
);

describe.each(cases)(
  "rejects $initialHash to $hashing hash changes with $order history in HTTP $view streams",
  ({ hashing, initialHash, order, view }) => {
    it.effect("guards cache identity before executing HTTP streams", () =>
      Effect.gen(function* rejectHttpHashChanges() {
        expect.assertions(5);
        const api = HttpApi.make("stream-hashing").add(
          HttpApiGroup.make("events").add(
            HttpApiEndpoint.get("watch", "/watch", {
              success: HttpApiSchema.StreamSse({ data: Schema.Int }),
            })
          )
        );
        let executions = 0;
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: HttpClient.make((request) => {
            executions += 1;
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response("data: 2\n\n", {
                  headers: { "content-type": "text/event-stream" },
                })
              )
            );
          }),
        });
        const http = createHttpApiQueryUtils(api, {
          client,
          keyPrefix: ["stream-hashing"],
        });
        const identity = {
          _tag: "EffectHttpApiQueryConfigError",
          apiId: "stream-hashing",
          groupId: "events",
          endpoint: "watch",
          method: "GET",
        };
        const verification =
          view === "live"
            ? verifyHashGuard(
                http.events.watch.liveOptions(),
                1,
                3,
                2,
                hashing,
                initialHash,
                order,
                identity,
                () => executions
              )
            : verifyHashGuard(
                http.events.watch.streamedOptions({ refetchMode: view }),
                [1],
                [3],
                view === "append" ? [3, 2] : [2],
                hashing,
                initialHash,
                order,
                identity,
                () => executions
              );
        yield* verification;
      })
    );
  }
);

const defaultHashCases = (["rpc", "http"] as const).flatMap((adapter) =>
  (["global", "prefix"] as const).flatMap((hashing) =>
    (["native", "custom"] as const).flatMap((effectiveHash) =>
      (["matching", "mismatched"] as const).flatMap((consistency) =>
        (["reset", "append", "replace", "live"] as const).map((view) => ({
          adapter,
          hashing,
          effectiveHash,
          consistency,
          view,
        }))
      )
    )
  )
);

const customDefaultHash = (key: QueryKey) => `stream:${hashKey(key)}`;

const verifyDefaultHash = Effect.fnUntraced(function* verifyDefaultHash<Data>(
  options: {
    readonly queryKey: QueryKey;
    readonly queryFn: QueryFunction<Data>;
  },
  initialData: Data,
  expectedData: Data,
  hashing: "global" | "prefix",
  effectiveHash: "native" | "custom",
  consistency: "matching" | "mismatched",
  identity: Readonly<Record<string, string>>,
  executions: () => number
) {
  const queryKeyHashFn =
    effectiveHash === "custom" ? customDefaultHash : hashKey;
  const queryHash =
    consistency === "matching"
      ? queryKeyHashFn(options.queryKey)
      : "only-watch";
  const defaults = {
    queryHash,
    ...(effectiveHash === "custom" ? { queryKeyHashFn } : undefined),
  };
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        ...(hashing === "global" ? defaults : undefined),
      },
    },
  });
  if (hashing === "prefix") {
    queryClient.setQueryDefaults(options.queryKey, defaults);
  }
  queryClient.setQueryData(options.queryKey, initialData);
  const cached = queryClient.getQueryCache().get(queryHash);
  const initialUpdatedAt = cached?.state.dataUpdatedAt;
  try {
    if (consistency === "mismatched") {
      yield* Effect.promise(async () => {
        await expect(queryClient.query(options)).rejects.toMatchObject({
          ...identity,
          code: "UnsupportedQueryHash",
        });
      });
      expect(cached?.state.data).toStrictEqual(initialData);
      expect(cached?.state.dataUpdatedAt).toBe(initialUpdatedAt);
      expect(executions()).toBe(0);
    } else {
      expect(
        yield* Effect.promise(async () => await queryClient.query(options))
      ).toStrictEqual(expectedData);
      expect(cached?.state.data).toStrictEqual(expectedData);
      expect(executions()).toBe(1);
    }
  } finally {
    queryClient.clear();
  }
});

describe.each(defaultHashCases)(
  "handles $consistency $hashing default queryHash with $effectiveHash hashing in $adapter $view streams",
  ({ adapter, hashing, effectiveHash, consistency, view }) => {
    it.effect(
      "enforces consistency between queryHash and effective hashing",
      () =>
        Effect.gen(function* verifyConfiguredHash() {
          expect.assertions(consistency === "matching" ? 3 : 4);
          const group = RpcGroup.make(
            Rpc.make("watch", { success: Schema.Int, stream: true })
          );
          let executions = 0;
          const rpcClient = yield* makeRpcTestClient(group, {
            watch: () => {
              executions += 1;
              return Stream.succeed(2);
            },
          });
          const rpc = createRpcQueryUtils(group, {
            client: rpcClient,
            keyPrefix: ["stream-hashing"],
          });
          const api = HttpApi.make("stream-hashing").add(
            HttpApiGroup.make("events").add(
              HttpApiEndpoint.get("watch", "/watch", {
                success: HttpApiSchema.StreamSse({ data: Schema.Int }),
              })
            )
          );
          const httpClient = yield* HttpApiClient.makeWith(api, {
            baseUrl: "https://example.test",
            httpClient: HttpClient.make((request) => {
              executions += 1;
              return Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response("data: 2\n\n", {
                    headers: { "content-type": "text/event-stream" },
                  })
                )
              );
            }),
          });
          const http = createHttpApiQueryUtils(api, {
            client: httpClient,
            keyPrefix: ["stream-hashing"],
          });
          const identity =
            adapter === "rpc"
              ? { _tag: "EffectRpcQueryConfigError", rpcTag: "watch" }
              : {
                  _tag: "EffectHttpApiQueryConfigError",
                  apiId: "stream-hashing",
                  groupId: "events",
                  endpoint: "watch",
                  method: "GET",
                };
          const verification =
            view === "live"
              ? verifyDefaultHash(
                  adapter === "rpc"
                    ? rpc.watch.liveOptions()
                    : http.events.watch.liveOptions(),
                  1,
                  2,
                  hashing,
                  effectiveHash,
                  consistency,
                  identity,
                  () => executions
                )
              : verifyDefaultHash(
                  adapter === "rpc"
                    ? rpc.watch.streamedOptions({ refetchMode: view })
                    : http.events.watch.streamedOptions({ refetchMode: view }),
                  [1],
                  view === "append" ? [1, 2] : [2],
                  hashing,
                  effectiveHash,
                  consistency,
                  identity,
                  () => executions
                );
          yield* verification;
        })
    );
  }
);

it.effect(
  "rejects a reentrant foreign-query replacement before executing or resetting its data",
  () =>
    Effect.gen(function* rejectReentrantReplacement() {
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      let executions = 0;
      const client = yield* makeRpcTestClient(group, {
        watch: () => {
          executions += 1;
          return Stream.succeed(1);
        },
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["reentrant-collision"],
      });
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const cache = queryClient.getQueryCache();
      queryClient.setQueryDefaults(["foreign"], {
        queryKeyHashFn: () => "foreign-constant",
      });
      const unsubscribe = cache.subscribe((event) => {
        if (
          event.type === "removed" &&
          event.query.queryHash === "foreign-constant"
        ) {
          queryClient.setQueryData(["foreign"], "replacement");
        }
      });
      try {
        yield* Effect.promise(
          async () => await queryClient.query(rpc.watch.streamedOptions())
        );
        queryClient.setQueryData(["foreign"], "original");
        queryClient.removeQueries({ queryKey: ["foreign"] });
        const replacement = cache.get("foreign-constant");
        const state = { ...replacement?.state };
        const error = yield* Effect.promise(
          async () =>
            await captureFailure(queryClient.query(rpc.watch.liveOptions()))
        );
        expect(error).toMatchObject({ code: "UnsupportedQueryHash" });
        expect(executions).toBe(1);
        expect(cache.get("foreign-constant")).toBe(replacement);
        expect(replacement?.state).toStrictEqual(state);
        expect(replacement?.state).toMatchObject({
          data: "replacement",
          status: "success",
          fetchStatus: "idle",
        });
      } finally {
        unsubscribe();
        queryClient.clear();
      }
    })
);

it.effect(
  "places a reentrant replacement after an already cached live query",
  () =>
    Effect.gen(function* preserveReplacementOrder() {
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      let executions = 0;
      const client = yield* makeRpcTestClient(group, {
        watch: () => {
          executions += 1;
          return Stream.succeed(1);
        },
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["replacement-order"],
      });
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const cache = queryClient.getQueryCache();
      queryClient.setQueryDefaults(["foreign"], {
        queryKeyHashFn: () => "foreign-constant",
      });
      const unsubscribe = cache.subscribe((event) => {
        if (
          event.type === "removed" &&
          event.query.queryHash === "foreign-constant"
        ) {
          queryClient.setQueryData(["foreign"], "replacement");
        }
      });
      try {
        yield* Effect.promise(
          async () => await queryClient.query(rpc.watch.streamedOptions())
        );
        queryClient.setQueryData(["foreign"], "original");
        queryClient.setQueryData(rpc.watch.liveKey(), 0);
        queryClient.removeQueries({ queryKey: ["foreign"] });
        const replacement = cache.get("foreign-constant");
        const state = { ...replacement?.state };
        expect(
          yield* Effect.promise(
            async () => await queryClient.query(rpc.watch.liveOptions())
          )
        ).toBe(1);
        expect(executions).toBe(2);
        expect(replacement?.state).toStrictEqual(state);
        expect(queryClient.getQueryData(rpc.watch.liveKey())).toBe(1);
      } finally {
        unsubscribe();
        queryClient.clear();
      }
    })
);

it.effect(
  "releases an empty cache index and rebuilds collision guards for the next execution",
  () =>
    Effect.gen(function* rebuildCacheIndex() {
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      let executions = 0;
      const client = yield* makeRpcTestClient(group, {
        watch: () => {
          executions += 1;
          return Stream.succeed(1);
        },
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["index-rebuild"],
      });
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const cache = queryClient.getQueryCache();
      try {
        yield* Effect.promise(
          async () => await queryClient.query(rpc.watch.streamedOptions())
        );
        const listening = cache.hasListeners();
        queryClient.clear();
        expect({
          active: listening,
          cleared: cache.hasListeners(),
        }).toStrictEqual({ active: true, cleared: false });
        queryClient.setQueryDefaults(["foreign"], {
          queryKeyHashFn: () => "foreign-constant",
        });
        queryClient.setQueryData(["foreign"], "untouched");
        const foreign = cache.get("foreign-constant");
        const state = { ...foreign?.state };
        const error = yield* Effect.promise(
          async () =>
            await captureFailure(queryClient.query(rpc.watch.liveOptions()))
        );
        expect(error).toMatchObject({ code: "UnsupportedQueryHash" });
        expect({
          executions,
          foreign: foreign?.state,
        }).toStrictEqual({
          executions: 1,
          foreign: state,
        });
        queryClient.removeQueries({ queryKey: ["foreign"] });
        expect({
          data: yield* Effect.promise(
            async () => await queryClient.query(rpc.watch.liveOptions())
          ),
          executions,
        }).toStrictEqual({ data: 1, executions: 2 });
      } finally {
        queryClient.clear();
        expect(cache.hasListeners()).toBe(false);
      }
    })
);

it.effect(
  "updates the hash index as unrelated constant-hash queries move before and after a stream",
  () =>
    Effect.gen(function* trackCollisionOrder() {
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      const client = yield* makeRpcTestClient(group, {
        watch: () => Stream.succeed(1),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["indexed-collisions"],
      });
      const options = rpc.watch.streamedOptions();
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      queryClient.setQueryDefaults(["foreign"], {
        queryKeyHashFn: () => "unrelated-constant",
      });
      try {
        expect(
          yield* Effect.promise(async () => await queryClient.query(options))
        ).toStrictEqual([1]);
        queryClient.setQueryData(["foreign"], "untouched");
        expect(
          yield* Effect.promise(async () => await queryClient.query(options))
        ).toStrictEqual([1]);
        const current = queryClient
          .getQueryCache()
          .get(hashKey(options.queryKey));
        if (current !== undefined) {
          queryClient.getQueryCache().remove(current);
        }
        const error = yield* Effect.promise(
          async () => await captureFailure(queryClient.query(options))
        );
        expect(error).toMatchObject({ code: "UnsupportedQueryHash" });
        expect(
          queryClient.getQueryCache().get("unrelated-constant")?.state.data
        ).toBe("untouched");
        queryClient.removeQueries({ queryKey: ["foreign"] });
        expect(
          yield* Effect.promise(async () => await queryClient.query(options))
        ).toStrictEqual([1]);
      } finally {
        queryClient.clear();
      }
    })
);

it.effect(
  "builds the conflict index once and leaves subsequent full-cache enumeration to native Query",
  () =>
    Effect.gen(function* avoidRepeatedEnumeration() {
      const group = RpcGroup.make(
        Rpc.make("watch", { success: Schema.Int, stream: true })
      );
      const client = yield* makeRpcTestClient(group, {
        watch: () => Stream.succeed(1),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["indexed-scale"],
      });
      const options = rpc.watch.streamedOptions();
      const queryClient = new QueryClient();
      for (let index = 0; index < 1000; index += 1) {
        queryClient.setQueryData(["unrelated", index], index);
      }
      const enumerate = vi.spyOn(queryClient.getQueryCache(), "getAll");
      try {
        yield* Effect.promise(async () => await queryClient.query(options));
        enumerate.mockClear();
        yield* Effect.promise(async () => await queryClient.query(options));
        const adapterEnumerations = enumerate.mock.calls.length;
        enumerate.mockClear();
        yield* Effect.promise(
          async () =>
            await queryClient.query({
              ...options,
              queryFn: experimental_streamedQuery({ streamFn: nativeStreamFn }),
            })
        );
        expect(adapterEnumerations).toBe(enumerate.mock.calls.length);
      } finally {
        enumerate.mockRestore();
        queryClient.clear();
      }
    })
);
