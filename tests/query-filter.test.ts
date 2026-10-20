import { describe, expect, it } from "@effect/vitest";
import { QueryClient } from "@tanstack/query-core";
import { Effect, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";

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
        const english = rpc.read.queryKey({ id: 1 });
        const french = rpc.read.queryKey({ id: 1, locale: "fr" });
        const otherUser = rpc.read.queryKey({ id: 2 });
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
    queryClient.setQueryData(http.users.read.queryKey(input), "one");
    queryClient.setQueryData(http.users.read.metadataKey(input), {
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
    const metadata = createQueryFilter(http.users.read, "metadata");
    expect(queryClient.getQueryCache().findAll(metadata())).toHaveLength(1);
    queryClient.clear();
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
        queryClient.setQueryData(rpc.read.queryKey({ id: 1, locale: "en" }), 1);
        expect(queryClient.getQueryCache().findAll(filter)).toHaveLength(1);
        expect(Object.isFrozen(filter.queryKey)).toBe(true);
        expect(Object.isFrozen(filter.queryKey?.at(-1))).toBe(true);
        queryClient.clear();
      })
  );
});
