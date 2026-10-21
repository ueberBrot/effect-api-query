import { expect, it } from "@effect/vitest";
import { QueryClient } from "@tanstack/query-core";
import { Effect, Redacted, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
} from "#effect-api-query";
import type { RunPromiseExit } from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc";
import { makeUnusedHttpClient } from "./fixtures/http-client";

it.effect(
  "shares RPC declaration analysis without reusing clients, runners or key encoders",
  () =>
    Effect.gen(function* isolatesRpcDeclarationOwners() {
      const group = RpcGroup.make(
        Rpc.make("read", {
          payload: { id: Schema.FiniteFromString },
          success: Schema.String,
        })
      );
      const first = yield* makeRpcTestClient(group, {
        read: () => Effect.succeed("first"),
      });
      const second = yield* makeRpcTestClient(group, {
        read: () => Effect.succeed("second"),
      });
      let firstRuns = 0;
      let secondRuns = 0;
      const firstRunner: RunPromiseExit = async (effect, options) => {
        firstRuns += 1;
        return await Effect.runPromiseExit(effect, options);
      };
      const secondRunner: RunPromiseExit = async (effect, options) => {
        secondRuns += 1;
        return await Effect.runPromiseExit(effect, options);
      };
      const a = createRpcQueryUtils(group, {
        client: first,
        keyPrefix: ["first"],
        runPromiseExit: firstRunner,
        keyEncoders: { read: ({ id }) => ({ entity: id }) },
      });
      const b = createRpcQueryUtils(group, {
        client: second,
        keyPrefix: ["second"],
        runPromiseExit: secondRunner,
      });
      const queryClient = new QueryClient();
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(a.read.queryOptions({ input: { id: 1 } }))
        )
      ).toBe("first");
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(b.read.queryOptions({ input: { id: 1 } }))
        )
      ).toBe("second");
      expect(a.read.queryKey({ id: 1 }).at(-1)).toStrictEqual({ entity: 1 });
      expect(b.read.queryKey({ id: 1 }).at(-1)).toStrictEqual({ id: "1" });
      expect([firstRuns, secondRuns]).toStrictEqual([1, 1]);
      queryClient.clear();
    })
);

it.effect(
  "shares HTTP declaration analysis while preserving each ready client and API identity",
  () =>
    Effect.gen(function* isolatesHttpDeclarationOwners() {
      const group = HttpApiGroup.make("users").add(
        HttpApiEndpoint.get("read", "/users/:id", {
          params: { id: Schema.FiniteFromString },
          success: Schema.String,
        })
      );
      const api = HttpApi.make("shared").add(group);
      const otherApi = HttpApi.make("other").add(group);
      const makeClient = (value: string) =>
        HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(request, Response.json(value))
            )
          ),
        });
      const firstClient = yield* makeClient("first");
      const secondClient = yield* makeClient("second");
      const first = createHttpApiQueryUtils(api, {
        client: firstClient,
        keyPrefix: ["first"],
      });
      const second = createHttpApiQueryUtils(api, {
        client: secondClient,
        keyPrefix: ["second"],
      });
      const other = createHttpApiQueryUtils(otherApi, {
        client: secondClient,
        keyPrefix: ["second"],
      });
      const input = { params: { id: 1 } };
      const queryClient = new QueryClient();
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(first.users.read.queryOptions({ input }))
        )
      ).toBe("first");
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(second.users.read.queryOptions({ input }))
        )
      ).toBe("second");
      expect(other.users.read.queryKey(input)).not.toStrictEqual(
        second.users.read.queryKey(input)
      );
      queryClient.clear();
    })
);

it.effect("reuses completed encoder-required RPC analysis", () =>
  Effect.gen(function* reusesRequiredRpcAnalysis() {
    const payload = Schema.Struct({ secret: Schema.Redacted(Schema.String) });
    const { annotations } = payload.ast;
    let inspections = 0;
    Object.defineProperty(payload.ast, "annotations", {
      get() {
        inspections += 1;
        return annotations;
      },
    });
    const declaration = Rpc.make("read", { payload, success: Schema.String });
    let payloadReads = 0;
    Object.defineProperty(declaration, "payloadSchema", {
      get() {
        payloadReads += 1;
        return payload;
      },
    });
    const group = RpcGroup.make(declaration);
    const otherGroup = RpcGroup.make(
      Rpc.make("read", { payload, success: Schema.String })
    );
    const client = yield* makeRpcTestClient(group, {
      read: () => Effect.succeed("ok"),
    });
    const first = createRpcQueryUtils(group, {
      client,
      keyPrefix: ["first"],
      keyEncoders: { read: () => "first-identity" },
    });
    const firstInspections = inspections;
    const firstPayloadReads = payloadReads;
    expect(firstInspections).toBeGreaterThan(0);
    expect(firstPayloadReads).toBeGreaterThan(0);
    const second = createRpcQueryUtils(group, {
      client,
      keyPrefix: ["second"],
      keyEncoders: { read: () => "second-identity" },
    });
    expect(payloadReads).toBe(firstPayloadReads);
    createRpcQueryUtils(otherGroup, {
      client,
      keyPrefix: ["other"],
      keyEncoders: { read: () => "other-identity" },
    });
    expect(inspections).toBe(firstInspections);
    const input = { secret: Redacted.make("private") };
    expect([
      first.read.queryKey(input),
      second.read.queryKey(input),
    ]).toStrictEqual([
      ["first", "rpc", "read", "query", "first-identity"],
      ["second", "rpc", "read", "query", "second-identity"],
    ]);
  })
);

it.effect("reuses HTTP analysis with required and ambiguous encoders", () =>
  Effect.gen(function* reusesRequiredHttpAnalysis() {
    const api = HttpApi.make("required-encoders").add(
      HttpApiGroup.make("requests").add(
        HttpApiEndpoint.post("secret", "/secret", {
          payload: Schema.Redacted(Schema.String),
        }),
        HttpApiEndpoint.post("multiple", "/multiple", {
          payload: [Schema.String, Schema.Int],
        })
      )
    );
    const client = yield* makeUnusedHttpClient(api);
    const { groups } = api;
    let groupReads = 0;
    Object.defineProperty(api, "groups", {
      get() {
        groupReads += 1;
        return groups;
      },
    });
    const first = createHttpApiQueryUtils(api, {
      client,
      keyPrefix: ["first"],
      keyEncoders: {
        requests: {
          secret: () => "first-secret",
          multiple: ({ payload }) => ({ first: payload }),
        },
      },
    });
    const firstGroupReads = groupReads;
    expect(firstGroupReads).toBeGreaterThan(0);
    const secondEncoders = {
      requests: {
        secret: () => "second-secret",
        multiple: ({ payload }: { readonly payload: string | number }) => ({
          second: payload,
        }),
      },
    };
    const second = createHttpApiQueryUtils(api, {
      client,
      keyPrefix: ["second"],
      keyEncoders: secondEncoders,
    });
    expect(groupReads).toBe(firstGroupReads);
    const input = { payload: Redacted.make("private") };
    expect([
      first.requests.secret.queryKey(input).at(-1),
      second.requests.secret.queryKey(input).at(-1),
      first.requests.multiple.queryKey({ payload: 1 }).at(-1),
      second.requests.multiple.queryKey({ payload: 1 }).at(-1),
    ]).toStrictEqual([
      "first-secret",
      "second-secret",
      { first: 1 },
      { second: 1 },
    ]);
    Reflect.deleteProperty(secondEncoders.requests, "secret");
    expect(() =>
      createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["missing"],
        keyEncoders: secondEncoders,
      })
    ).toThrow(expect.objectContaining({ code: "MissingKeyEncoder" }));
    expect(groupReads).toBe(firstGroupReads);
  })
);

it.effect(
  "retries HTTP suspended inspection even after a custom-encoder tree succeeds",
  () =>
    Effect.sync(() => {
      let ready = false;
      let inspections = 0;
      const Payload = Schema.suspend(() => {
        inspections += 1;
        if (!ready) {
          throw new Error("Payload is unavailable");
        }
        return Schema.Struct({ id: Schema.Int });
      });
      const api = HttpApi.make("suspended").add(
        HttpApiGroup.make("requests").add(
          HttpApiEndpoint.post("read", "/read", { payload: Payload })
        )
      );
      const client = {
        requests: {
          read: () => {
            throw new Error("Key preparation must not execute HTTP requests");
          },
        },
      };
      expect(() =>
        createHttpApiQueryUtils(api, { client, keyPrefix: ["missing"] })
      ).toThrow(expect.objectContaining({ code: "MissingKeyEncoder" }));
      expect(inspections).toBe(1);
      const custom = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["custom"],
        keyEncoders: { requests: { read: ({ payload }) => payload.id } },
      });
      expect(inspections).toBe(2);
      ready = true;
      const recovered = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["recovered"],
      });
      createHttpApiQueryUtils(api, { client, keyPrefix: ["cached"] });
      expect({
        inspections,
        recoveredKey: recovered.requests.read.queryKey({ payload: { id: 1 } }),
        customKey: custom.requests.read.queryKey({ payload: { id: 1 } }).at(-1),
      }).toStrictEqual({
        inspections: 3,
        recoveredKey: [
          "recovered",
          "http",
          "suspended",
          "requests",
          "read",
          "query",
          { payload: { id: 1 } },
        ],
        customKey: 1,
      });
    })
);
