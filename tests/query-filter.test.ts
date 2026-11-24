import { describe, expect, it } from "@effect/vitest";
import {
  hashKey,
  QueryClient,
  QueryObserver,
  skipToken,
} from "@tanstack/query-core";
import { Effect, Predicate, Schema, Stream } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import { vi } from "vitest";

import {
  configureUtils,
  createHttpApiQueryUtils,
  createQueryFilter,
  createRpcQueryUtils,
  prepareInput,
} from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc";
import { makeUnusedHttpClient } from "./fixtures/http-client";

describe("query filters", () => {
  it.effect(
    "matches every defaulted locale through a typed encoded partial projection",
    () =>
      Effect.gen(function* matchesProjectedFilterInput() {
        const group = RpcGroup.make(
          Rpc.make("read", {
            payload: {
              id: Schema.FiniteFromString,
              locale: Schema.String.pipe(
                Schema.withConstructorDefault(Effect.succeed("en"))
              ),
            },
            success: Schema.String,
          })
        );
        const client = yield* makeRpcTestClient(group, {
          read: ({ locale }) => Effect.succeed(locale),
        });
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["filters"],
        });
        const queryClient = new QueryClient();
        const english = rpc.read.queryKey({ input: { id: 1 } });
        const french = rpc.read.queryKey({ input: { id: 1, locale: "fr" } });
        const otherUser = rpc.read.queryKey({ input: { id: 2 } });
        queryClient.setQueryData(english, "en");
        queryClient.setQueryData(french, "fr");
        queryClient.setQueryData(otherUser, "en");
        const userFilter = createQueryFilter(
          rpc.read,
          "query",
          (id: number) => ({ id: String(id) })
        );
        yield* Effect.promise(async () => {
          await queryClient.invalidateQueries({
            ...userFilter(1),
            refetchType: "none",
          });
        });
        expect(queryClient.getQueryState(english)?.isInvalidated).toBe(true);
        expect(queryClient.getQueryState(french)?.isInvalidated).toBe(true);
        expect(queryClient.getQueryState(otherUser)?.isInvalidated).toBe(false);
        queryClient.clear();
      })
  );

  it.effect(
    "uses configured stream policy with prepared input and exact matching",
    () =>
      Effect.gen(function* matchesConfiguredStreamPolicy() {
        const group = RpcGroup.make(
          Rpc.make("watch", {
            payload: {
              id: Schema.FiniteFromString,
              locale: Schema.optionalKey(Schema.String),
            },
            success: Schema.String,
            stream: true,
          })
        );
        const client = yield* makeRpcTestClient(group, {
          watch: () => Stream.empty,
        });
        const { watch } = configureUtils(
          createRpcQueryUtils(group, { client }),
          {
            streamed: { maxChunks: 2 },
          }
        );
        const input = prepareInput(watch, { id: 1 });
        const exactKey = watch.streamedKey({ input, refetchMode: "reset" });
        const queryClient = new QueryClient();
        const skipped = new QueryObserver(
          queryClient,
          watch.streamedOptions({ input: skipToken })
        );
        queryClient.setQueryData(exactKey, ["default"]);
        queryClient.setQueryData(
          watch.streamedKey({ input, publicationBatchSize: 2 }),
          ["batched"]
        );
        queryClient.setQueryData(watch.streamedKey({ input, maxChunks: 3 }), [
          "long",
        ]);
        queryClient.setQueryData(watch.streamedKey({ input: { id: 2 } }), [
          "other",
        ]);
        queryClient.setQueryData(
          watch.streamedKey({ input: { id: 1, locale: "fr" } }),
          ["localized"]
        );
        const filter = {
          view: "streamed",
          input,
          refetchMode: "reset",
        } as const;

        expect(
          queryClient.getQueriesData(watch.queryFilter(filter))
        ).toStrictEqual([[exactKey, ["default"]]]);
        expect(
          queryClient.getQueriesData(
            watch.queryFilter({ ...filter, exact: true })
          )
        ).toStrictEqual([[exactKey, ["default"]]]);
        expect(
          queryClient.getQueriesData(
            watch.queryFilter({ view: "streamed", input })
          )
        ).toHaveLength(3);
        expect(
          queryClient.getQueriesData(
            watch.queryFilter({ view: "streamed", input, exact: true })
          )
        ).toHaveLength(0);
        const policyOnly = { view: "streamed", refetchMode: "reset" } as const;
        expect({
          skipped: skipped.getCurrentResult().fetchStatus,
          broadCount: queryClient.getQueriesData(watch.queryFilter(policyOnly))
            .length,
          exact: queryClient.getQueriesData(
            watch.queryFilter({ ...policyOnly, exact: true })
          ),
        }).toStrictEqual({ skipped: "idle", broadCount: 3, exact: [] });
      })
  );

  it("matches canonical SSE identity across inputs and respects native predicates", () => {
    const api = HttpApi.make("filters").add(
      HttpApiGroup.make("events").add(
        HttpApiEndpoint.get("watch", "/:id", {
          params: { id: Schema.String },
          success: HttpApiSchema.StreamSse({ data: Schema.String }),
        })
      )
    );
    const { watch } = configureUtils(
      createHttpApiQueryUtils(api, {
        client: Effect.runSync(makeUnusedHttpClient(api)),
      }),
      {
        paths: {
          "events.watch": { live: { sseOptions: { maxEventSize: 128 } } },
        },
      }
    ).events;
    const input = { params: { id: "one" } };
    const queryClient = new QueryClient();
    const one = watch.liveKey({ input });
    const two = watch.liveKey({ input: { params: { id: "two" } } });
    queryClient.setQueryData(one, "one");
    queryClient.setQueryData(two, "two");
    queryClient.setQueryData(
      watch.liveKey({ input, sseOptions: { maxEventSize: 256 } }),
      "larger"
    );
    queryClient.setQueryData(
      watch.liveKey({
        input,
        sseOptions: { maxEventSize: 128, dispatchEmptyNamedEvents: true },
      }),
      "empty"
    );
    const policy = { maxEventSize: 128, dispatchEmptyNamedEvents: false };
    expect(
      queryClient.getQueriesData(
        watch.queryFilter({
          view: "live",
          coalesceMs: undefined,
          predicate: (query) => query.state.data === "two",
        })
      )
    ).toStrictEqual([[two, "two"]]);
    expect(
      queryClient.getQueriesData(
        watch.queryFilter({ view: "live", sseOptions: policy })
      )
    ).toStrictEqual([
      [one, "one"],
      [two, "two"],
    ]);
    expect(
      queryClient.getQueriesData(
        watch.queryFilter({
          view: "live",
          input,
          sseOptions: policy,
          exact: true,
          predicate: (query) => query.state.data === "one",
        })
      )
    ).toStrictEqual([[one, "one"]]);
    expect(
      queryClient.getQueriesData(watch.queryFilter({ view: "live", input }))
    ).toHaveLength(3);
  });

  it("keeps HTTP view and request containers separate while applying native conditions", () => {
    const api = HttpApi.make("filters").add(
      HttpApiGroup.make("users").add(
        HttpApiEndpoint.get("read", "/:id", {
          params: { id: Schema.FiniteFromString },
          headers: { "X-Locale": Schema.String },
          success: Schema.String,
        })
      )
    );
    const http = createHttpApiQueryUtils(api, {
      client: Effect.runSync(makeUnusedHttpClient(api)),
      keyPrefix: ["filters"],
    });
    const input = { params: { id: 1 }, headers: { "X-Locale": "en" } };
    const queryClient = new QueryClient();
    queryClient.setQueryData(http.users.read.queryKey({ input }), "one");
    queryClient.setQueryData(http.users.read.metadataKey({ input }), {
      data: "one",
      status: 200,
      headers: {},
    });
    const locale = createQueryFilter(
      http.users.read,
      "query",
      (language: string) => ({
        headers: { "x-locale": language },
      })
    );
    expect(
      queryClient.getQueryCache().findAll(locale("en", { type: "inactive" }))
    ).toHaveLength(1);
    expect(queryClient.getQueryCache().findAll(locale("fr"))).toHaveLength(0);
    const metadata = http.users.read.queryFilter({ view: "metadata", input });
    expect(queryClient.getQueryCache().findAll(metadata)).toHaveLength(1);
    queryClient.clear();
  });

  it("matches literal HTTP paths without constructing leaves", () => {
    const api = HttpApi.make("filters").add(
      HttpApiGroup.make("users.v1").add(
        HttpApiEndpoint.get("read.one", "/read", { success: Schema.String })
      ),
      HttpApiGroup.make("health", { topLevel: true }).add(
        HttpApiEndpoint.get("ping", "/ping", { success: Schema.String })
      )
    );
    const http = createHttpApiQueryUtils(api, {
      client: Effect.runSync(makeUnusedHttpClient(api)),
    });
    const queryClient = new QueryClient();
    const branch = http["users.v1"];
    const read = [
      "effect-api-query:v2:[]",
      "http",
      "filters",
      "users.v1",
      "read.one",
      null,
      "query",
    ];
    const metadata = [
      "effect-api-query:v2:[]",
      "http",
      "filters",
      "users.v1",
      "read.one",
      null,
      "metadata",
    ];
    const topLevel = [
      "effect-api-query:v2:[]",
      "http",
      "filters",
      "ping",
      null,
      "query",
    ];
    const unrelated = [
      "effect-api-query:v2:[]",
      "http",
      "filters",
      "users.v1",
      "unknown",
      null,
      "query",
    ];
    queryClient.setQueryData(read, "read");
    queryClient.setQueryData(metadata, "metadata");
    queryClient.setQueryData(topLevel, "top-level");
    queryClient.setQueryData(unrelated, "unrelated");

    const freeze = vi.spyOn(Object, "freeze");
    const frozenLeaves = () =>
      freeze.mock.calls.filter(([value]) =>
        Predicate.hasProperty(value, "queryOptions")
      );
    try {
      expect({
        branchView: queryClient.getQueriesData(
          branch.queryFilter({ view: "query" })
        ),
        rootView: queryClient.getQueriesData(
          http.queryFilter({ view: "query" })
        ),
        allViews: queryClient.getQueriesData(http.queryFilter()).length,
        frozenLeaves: frozenLeaves().length,
      }).toStrictEqual({
        branchView: [[read, "read"]],
        rootView: [
          [read, "read"],
          [topLevel, "top-level"],
        ],
        allViews: 4,
        frozenLeaves: 0,
      });
      expect(branch["read.one"].queryKey()).toStrictEqual(read);
      expect(frozenLeaves()).toHaveLength(1);
    } finally {
      freeze.mockRestore();
      queryClient.clear();
    }
  });

  it("refetches, cancels, and resets only the selected view", async () => {
    const api = HttpApi.make("filters").add(
      HttpApiGroup.make("users").add(
        HttpApiEndpoint.get("read", "/read", { success: Schema.String })
      )
    );
    const http = createHttpApiQueryUtils(api, {
      client: Effect.runSync(makeUnusedHttpClient(api)),
    });
    const queryClient = new QueryClient();
    const read = http.users.read.queryOptions();
    const metadata = http.users.read.metadataKey();
    const filter = http.users.queryFilter({ view: "query" });
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("1")
      .mockResolvedValueOnce("2");
    try {
      await queryClient.query({ ...read, queryFn });
      queryClient.setQueryData(metadata, {
        data: "metadata",
        status: 200,
        headers: {},
      });
      await queryClient.refetchQueries(filter);
      expect(queryClient.getQueryData(read.queryKey)).toBe("2");

      const cancelled = vi.fn<() => void>();
      const pending = queryClient.query({
        ...read,
        queryFn: async ({ signal }) => {
          signal.addEventListener("abort", cancelled, { once: true });
          return await Effect.runPromise(Effect.never, { signal });
        },
      });
      const completion = pending.catch(() => null);
      await queryClient.cancelQueries(filter);
      await completion;
      expect(cancelled).toHaveBeenCalledOnce();

      await queryClient.resetQueries(filter);
      expect(queryClient.getQueryData(read.queryKey)).toBeUndefined();
      expect(queryClient.getQueryData(metadata)?.data).toBe("metadata");
    } finally {
      queryClient.clear();
    }
  });

  it.effect(
    "supports custom key projections and copies filter values before cache matching",
    () =>
      Effect.gen(function* copiesCustomFilterProjection() {
        const group = RpcGroup.make(
          Rpc.make("read", {
            payload: { id: Schema.Int, locale: Schema.String },
            success: Schema.Int,
          })
        );
        const client = yield* makeRpcTestClient(group, {
          read: ({ id }) => Effect.succeed(id),
        });
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["filters"],
          keyEncoders: {
            read: ({ id, locale }) => ({ entity: { id }, locale }),
          },
        });
        const projection = { entity: { id: 1 } };
        const filter = createQueryFilter(
          rpc.read,
          "query",
          (_input: null) => projection
        )(null);
        projection.entity.id = 2;
        const queryClient = new QueryClient();
        queryClient.setQueryData(
          rpc.read.queryKey({ input: { id: 1, locale: "en" } }),
          1
        );
        expect(queryClient.getQueryCache().findAll(filter)).toHaveLength(1);
        expect(Object.isFrozen(filter.queryKey)).toBe(true);
        expect(Object.isFrozen(filter.queryKey?.at(-1))).toBe(true);
        queryClient.clear();
      })
  );

  it.effect(
    "isolates structured RPC and HTTP namespaces in native cache operations",
    () =>
      Effect.gen(function* isolateStructuredNamespaces() {
        const group = RpcGroup.make(
          Rpc.make("users.read", { success: Schema.String })
        );
        const rpcClient = yield* makeRpcTestClient(group, {
          "users.read": () => Effect.succeed("read"),
        });
        const api = HttpApi.make("directory").add(
          HttpApiGroup.make("users").add(
            HttpApiEndpoint.get("read", "/read", { success: Schema.String })
          )
        );
        const httpClient = yield* makeUnusedHttpClient(api);
        const keyPrefix = [{ scope: "directory" }, ["reader"]] as const;
        const withExtraField = [
          { scope: "directory", locale: "en" },
          ["reader"],
        ] as const;
        const withExtraElement = [
          { scope: "directory" },
          ["reader", "writer"],
        ] as const;
        const withExtraSegment = [...keyPrefix, "local"] as const;
        const rpc = createRpcQueryUtils(group, {
          client: rpcClient,
          keyPrefix,
        });
        const http = createHttpApiQueryUtils(api, {
          client: httpClient,
          keyPrefix,
        });

        const foreign = [
          createRpcQueryUtils(group, {
            client: rpcClient,
            keyPrefix: withExtraField,
          }),
          createRpcQueryUtils(group, {
            client: rpcClient,
            keyPrefix: withExtraElement,
          }),
          createRpcQueryUtils(group, {
            client: rpcClient,
            keyPrefix: withExtraSegment,
          }),
          createRpcQueryUtils(group, { client: rpcClient }),
          createHttpApiQueryUtils(api, {
            client: httpClient,
            keyPrefix: withExtraField,
          }),
          createHttpApiQueryUtils(api, {
            client: httpClient,
            keyPrefix: withExtraElement,
          }),
          createHttpApiQueryUtils(api, {
            client: httpClient,
            keyPrefix: withExtraSegment,
          }),
          createHttpApiQueryUtils(api, { client: httpClient }),
        ].map((tree) => tree.users.read.queryKey());
        const client = new QueryClient();
        try {
          for (const key of foreign) {
            client.setQueryData(key, "foreign");
          }
          for (const tree of [rpc, http]) {
            const key = tree.users.read.queryKey();
            const descendant = [...tree.users.key(), "local", "entry"];
            client.setQueryData(key, "selected");
            client.setQueryData(descendant, "descendant");

            expect({
              root: client.getQueriesData(tree.queryFilter()),
              nativeConditions: client.getQueriesData(
                tree.users.queryFilter({
                  type: "inactive",
                  fetchStatus: "idle",
                  predicate: (query) => query.state.data === "selected",
                })
              ),
              exact: client.getQueriesData(
                tree.users.queryFilter({ exact: true })
              ),
              view: client.getQueriesData(
                tree.users.queryFilter({ view: "query" })
              ),
            }).toStrictEqual({
              root: [
                [key, "selected"],
                [descendant, "descendant"],
              ],
              nativeConditions: [[key, "selected"]],
              exact: [],
              view: [[key, "selected"]],
            });

            client.setQueryDefaults(tree.key(), { staleTime: 1000 });
            expect({
              selected: client.getQueryDefaults(key).staleTime,
              foreign: foreign.every(
                (other) =>
                  client.getQueryDefaults(other).staleTime === undefined
              ),
            }).toStrictEqual({
              selected: 1000,
              foreign: true,
            });
            expect(
              client.setQueriesData(tree.users.queryFilter(), () => "updated")
            ).toStrictEqual([
              [key, "updated"],
              [descendant, "updated"],
            ]);
            client.removeQueries(tree.queryFilter());
            expect(client.getQueriesData(tree.queryFilter())).toStrictEqual([]);
          }
          expect(foreign.map((key) => client.getQueryData(key))).toStrictEqual(
            foreign.map(() => "foreign")
          );
        } finally {
          client.clear();
        }
      })
  );

  it("checks the actual namespace with a native exact filter and a custom hash", () => {
    const api = HttpApi.make("directory").add(
      HttpApiGroup.make("users").add(
        HttpApiEndpoint.get("read", "/read", { success: Schema.String })
      )
    );
    const httpClient = Effect.runSync(makeUnusedHttpClient(api));
    const current = createHttpApiQueryUtils(api, {
      client: httpClient,
      keyPrefix: ["active"],
    });
    const foreign = createHttpApiQueryUtils(api, {
      client: httpClient,
      keyPrefix: ["archived"],
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { queryKeyHashFn: ([, adapter]) => hashKey([adapter]) },
      },
    });
    try {
      client.setQueryData(foreign.users.read.queryKey(), "archived");
      const predicate = vi.fn<() => boolean>(() => true);
      expect({
        root: client.getQueriesData(
          current.queryFilter({ exact: true, predicate })
        ),
        branch: client.getQueriesData(
          current.users.queryFilter({ exact: true, predicate })
        ),
        predicate: predicate.mock.calls.length,
      }).toStrictEqual({ root: [], branch: [], predicate: 0 });
    } finally {
      client.clear();
    }
  });
});
