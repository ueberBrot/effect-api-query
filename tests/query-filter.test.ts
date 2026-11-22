import { describe, expect, it } from "@effect/vitest";
import { QueryClient } from "@tanstack/query-core";
import { Effect, Predicate, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import { vi } from "vitest";

import {
  createHttpApiQueryUtils,
  createQueryFilter,
  createRpcQueryUtils,
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
    const read = ["http", "filters", "users.v1", "read.one", "query"];
    const metadata = ["http", "filters", "users.v1", "read.one", "metadata"];
    const topLevel = ["http", "filters", "ping", "query"];
    const unrelated = ["http", "filters", "users.v1", "unknown", "query"];
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
});
