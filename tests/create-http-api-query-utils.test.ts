import { QueryClient } from "@tanstack/query-core";
import { Cause, Effect, Exit, Layer, Schema, Scope } from "effect";
import { HttpClient, HttpClientResponse, HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createHttpApiQueryUtils,
  EffectHttpApiQueryConfigError,
  EffectHttpApiQueryError,
  EffectHttpApiQueryKeyError,
  isEffectHttpApiQueryError,
  createRpcQueryUtils,
} from "#effect-api-query";

import { captureFailure } from "./fixtures/async";
import { makeUnusedHttpClient } from "./fixtures/http-client";

const Api = HttpApi.make("test").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("get", "/users/:id", {
      params: { id: Schema.FiniteFromString },
      success: Schema.Struct({ id: Schema.Finite, name: Schema.String }),
    }),
    HttpApiEndpoint.post("create", "/users", {
      payload: Schema.Struct({ name: Schema.String }),
      success: Schema.Struct({ id: Schema.Finite, name: Schema.String }),
    }),
    HttpApiEndpoint.delete("remove", "/users/:id", {
      params: { id: Schema.FiniteFromString },
    })
  )
);
const Handlers = HttpApiBuilder.group(Api, "users", (handlers) =>
  handlers
    .handle("get", ({ params }) =>
      Effect.succeed({ id: params.id, name: "Ada" })
    )
    .handle("create", ({ payload }) =>
      Effect.succeed({ id: 2, name: payload.name })
    )
    .handle("remove", () => Effect.void)
);

const makeClient = HttpApiTest.groups(Api, ["users"]).pipe(
  Effect.provide(Layer.mergeAll(Handlers, HttpServer.layerServices))
);

describe(createHttpApiQueryUtils, () => {
  it("rejects sparse key prefixes through both adapters, including nested arrays", () => {
    const sparse = ["app", "tenant"] as const;
    Reflect.deleteProperty(sparse, 1);

    for (const keyPrefix of [sparse, ["app", sparse] as const]) {
      expect(() =>
        createHttpApiQueryUtils(HttpApi.make("empty"), {
          client: {},
          keyPrefix,
        })
      ).toThrow(
        expect.objectContaining({
          _tag: "EffectHttpApiQueryConfigError",
          code: "InvalidKeyPrefix",
        })
      );
      expect(() =>
        createRpcQueryUtils(RpcGroup.make(), {
          client: () => {
            throw new Error("Empty RPC group has no callable methods");
          },
          keyPrefix,
        })
      ).toThrow(
        expect.objectContaining({
          _tag: "EffectRpcQueryConfigError",
          code: "InvalidKeyPrefix",
        })
      );
    }
  });

  it("executes decoded reads and writes through the real HTTP pipeline and QueryClient", async () => {
    const scope = Scope.makeUnsafe();
    const client = await Effect.runPromise(
      makeClient.pipe(Effect.provideService(Scope.Scope, scope))
    );
    const utils = createHttpApiQueryUtils(Api, {
      client,
      keyPrefix: ["shared"],
    });
    const queryClient = new QueryClient();
    try {
      /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
      await expect(
        queryClient.query(
          utils.users.get.queryOptions({
            input: {
              params: { id: 1 },
              responseMode: "response-only",
            } as never,
          })
        )
      ).resolves.toStrictEqual({ id: 1, name: "Ada" });
      /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
      const mutation = queryClient
        .getMutationCache()
        .build(queryClient, utils.users.create.mutationOptions());
      /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
      await expect(
        mutation.execute({
          payload: { name: "Grace" },
          responseMode: "decoded-and-response",
        } as never)
      ).resolves.toStrictEqual({
        id: 2,
        name: "Grace",
      });
      /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
      await expect(
        queryClient.query(
          utils.users.remove.queryOptions({ input: { params: { id: 1 } } })
        )
      ).resolves.toBeNull();
      await expect(
        queryClient
          .getMutationCache()
          .build(queryClient, utils.users.remove.mutationOptions())
          .execute({ params: { id: 1 } })
      ).resolves.toBeUndefined();
      expect(utils.users.get.queryKey({ params: { id: 1 } })).toStrictEqual([
        "shared",
        "http",
        "test",
        "users",
        "get",
        "query",
        { params: { id: "1" } },
      ]);
    } finally {
      queryClient.clear();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("retains buffered multipart mutations and omits streaming endpoints and empty groups", () => {
    const streaming = HttpApiEndpoint.get("mixed", "/mixed", {
      success: [
        Schema.String,
        HttpApiSchema.StreamUint8Array({
          contentType: "application/octet-stream",
        }),
      ],
    });
    const wrapped = HttpApiEndpoint.get("wrapped", "/wrapped", {
      success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamUint8Array(), {}),
    });
    const multipart = HttpApiEndpoint.post("upload", "/upload", {
      payload: [
        Schema.Struct({ title: Schema.String }),
        Schema.Struct({ file: Schema.String }).pipe(
          HttpApiSchema.asMultipart()
        ),
      ],
    });
    const multipartStream = HttpApiEndpoint.post(
      "uploadStream",
      "/upload-stream",
      {
        payload: Schema.Struct({ file: Schema.String }).pipe(
          HttpApiSchema.asMultipartStream()
        ),
      }
    );
    const brandedMultipart = HttpApiEndpoint.post(
      "brandedUpload",
      "/branded-upload",
      {
        payload: Schema.Struct({ file: Schema.String }).pipe(
          HttpApiSchema.asMultipart(),
          Schema.brand("test/Upload")
        ),
      }
    );
    const mixed = HttpApi.make("mixed").add(
      HttpApiGroup.make("uploads").add(
        streaming,
        wrapped,
        multipart,
        multipartStream,
        brandedMultipart
      ),
      HttpApiGroup.make("empty").add(streaming, wrapped, multipartStream),
      HttpApiGroup.make("kept").add(
        HttpApiEndpoint.get("read", "/read", { success: Schema.String }),
        streaming
      )
    );
    const utils = createHttpApiQueryUtils(mixed, {
      client: Effect.runSync(makeUnusedHttpClient(mixed)),
      keyPrefix: ["test"],
    });
    expect(Object.keys(utils)).toStrictEqual(["key", "uploads", "kept"]);
    expect(Object.keys(utils.uploads)).toStrictEqual([
      "key",
      "upload",
      "brandedUpload",
    ]);
    expect(utils.uploads.upload.mutationKey()).toStrictEqual([
      "test",
      "http",
      "mixed",
      "uploads",
      "upload",
      "mutation",
    ]);
    expect(Object.keys(utils.kept)).toStrictEqual(["key", "read"]);
  });

  it("rejects contradictory multipart brands and encoding atomically", () => {
    const contradictory = [
      Schema.Struct({ file: Schema.String }).pipe(
        HttpApiSchema.asMultipart(),
        HttpApiSchema.asJson()
      ),
      Schema.Struct({ file: Schema.String }).pipe(
        HttpApiSchema.asMultipart(),
        Schema.brand("test/Upload"),
        HttpApiSchema.asJson()
      ),
      Schema.Struct({ file: Schema.String }).pipe(
        HttpApiSchema.asMultipart(),
        HttpApiSchema.asMultipartStream()
      ),
      Schema.Struct({ file: Schema.String }).annotate({
        "~httpApiEncoding": {
          _tag: "Multipart",
          mode: "buffered",
          contentType: "multipart/form-data",
        },
      }),
      Schema.Struct({ file: Schema.String })
        .pipe(HttpApiSchema.asMultipartStream())
        .annotate({
          "~httpApiEncoding": {
            _tag: "Multipart",
            mode: "buffered",
            contentType: "multipart/form-data",
          },
        }),
    ];
    for (const payload of contradictory) {
      const api = HttpApi.make("invalid").add(
        HttpApiGroup.make("files").add(
          HttpApiEndpoint.get("read", "/read", { success: Schema.String }),
          HttpApiEndpoint.post("upload", "/upload", { payload })
        )
      );
      expect(() =>
        createHttpApiQueryUtils(api, {
          client: Effect.runSync(makeUnusedHttpClient(api)),
          keyPrefix: ["test"],
        })
      ).toThrow(
        expect.objectContaining({
          _tag: "EffectHttpApiQueryConfigError",
          code: "UnsupportedEndpointMetadata",
          apiId: "invalid",
          groupId: "files",
          endpoint: "upload",
          method: "POST",
        })
      );
    }
  });

  it("projects literal identifiers and top-level inputless endpoints without splitting dots", async () => {
    const api = HttpApi.make("literal.api").add(
      HttpApiGroup.make("users.v1").add(
        HttpApiEndpoint.get("read.one", "/one", { success: Schema.String })
      ),
      HttpApiGroup.make("health.group", { topLevel: true }).add(
        HttpApiEndpoint.get("health.check", "/health", {
          success: Schema.String,
        })
      )
    );
    const client = Effect.runSync(
      HttpApiClient.makeWith(api, {
        baseUrl: "https://example.test",
        httpClient: HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(request.url.endsWith("/one") ? "one" : "healthy")
            )
          )
        ),
      })
    );
    const read = vi.spyOn(client["users.v1"], "read.one");
    const health = vi.spyOn(client, "health.check");
    const utils = createHttpApiQueryUtils(api, {
      client,
      keyPrefix: ["test"],
    });
    const queryClient = new QueryClient();
    try {
      await expect(
        queryClient.query(utils["users.v1"]["read.one"].queryOptions())
      ).resolves.toBe("one");
      await expect(
        queryClient.query(utils["health.check"].queryOptions())
      ).resolves.toBe("healthy");
      expect([...read.mock.calls, ...health.mock.calls]).toStrictEqual([
        [{ responseMode: "decoded-only" }],
        [{ responseMode: "decoded-only" }],
      ]);
      expect(utils["health.check"].queryKey()).toStrictEqual([
        "test",
        "http",
        "literal.api",
        "health.check",
        "query",
      ]);
      expect({
        root: Object.isFrozen(utils),
        group: Object.isFrozen(utils["users.v1"]),
      }).toStrictEqual({ root: true, group: true });
    } finally {
      queryClient.clear();
    }
  });

  it("rejects reserved paths and top-level collisions before constructing utilities", () => {
    const reservedGroup = HttpApi.make("invalid").add(
      HttpApiGroup.make("key").add(HttpApiEndpoint.get("read", "/read"))
    );
    const reservedEndpoint = HttpApi.make("invalid").add(
      HttpApiGroup.make("safe").add(HttpApiEndpoint.get("constructor", "/read"))
    );
    const emptyIdentifiers = HttpApi.make("invalid").add(
      HttpApiGroup.make("", { topLevel: true }).add(
        HttpApiEndpoint.get("", "/read")
      )
    );
    for (const [api, client] of [
      [reservedGroup, Effect.runSync(makeUnusedHttpClient(reservedGroup))],
      [
        reservedEndpoint,
        Effect.runSync(makeUnusedHttpClient(reservedEndpoint)),
      ],
      [
        emptyIdentifiers,
        Effect.runSync(makeUnusedHttpClient(emptyIdentifiers)),
      ],
    ] as const) {
      expect(() =>
        createHttpApiQueryUtils(api, {
          client,
          keyPrefix: ["test"],
        })
      ).toThrow(expect.objectContaining({ code: "InvalidEndpointPath" }));
    }
    const topLevel = HttpApiGroup.make("top", { topLevel: true }).add(
      HttpApiEndpoint.get("users", "/top")
    );
    const nested = HttpApiGroup.make("users").add(
      HttpApiEndpoint.get("read", "/users")
    );
    for (const groups of [
      [topLevel, nested],
      [nested, topLevel],
    ] as const) {
      const api = HttpApi.make("collision").add(...groups);
      expect(() =>
        createHttpApiQueryUtils(api, {
          client: Effect.runSync(makeUnusedHttpClient(api)),
          keyPrefix: ["test"],
        })
      ).toThrow(expect.objectContaining({ code: "EndpointPathCollision" }));
    }
    const duplicate = HttpApi.make("duplicate").add(
      topLevel,
      HttpApiGroup.make("another", { topLevel: true }).add(
        HttpApiEndpoint.get("users", "/another")
      )
    );
    expect(() =>
      createHttpApiQueryUtils(duplicate, {
        client: Effect.runSync(makeUnusedHttpClient(duplicate)),
        keyPrefix: ["test"],
      })
    ).toThrow(EffectHttpApiQueryConfigError);
  });

  it("preserves the complete failed Cause and passes runner rejections through", async () => {
    const api = HttpApi.make("failure").add(
      HttpApiGroup.make("actions").add(
        HttpApiEndpoint.get("fail", "/fail", {
          success: Schema.String,
          error: Schema.String,
        })
      )
    );
    const cause = Cause.combine(
      Cause.fail("denied"),
      Cause.die(new Error("defect"))
    );
    const client = Effect.runSync(
      HttpApiClient.makeWith(api, {
        baseUrl: "https://example.test",
        httpClient: HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(request, Response.json("unused"))
          )
        ),
        transformResponse: () => Effect.failCause(cause),
      })
    );
    const utils = createHttpApiQueryUtils(api, {
      client,
      keyPrefix: ["test"],
    });
    const queryClient = new QueryClient();
    try {
      const error = await captureFailure(
        queryClient.query(utils.actions.fail.queryOptions())
      );
      expect(error).toBeInstanceOf(EffectHttpApiQueryError);
      expect(isEffectHttpApiQueryError(error)).toBe(true);
      expect(error).toMatchObject({
        apiId: "failure",
        groupId: "actions",
        endpoint: "fail",
        method: "GET",
        operation: "query",
        cause,
      });
      if (!isEffectHttpApiQueryError(error)) {
        throw new Error("Expected HTTP execution error");
      }
      expect(error.cause).toBe(cause);
      const rejection = new Error("runner");
      const rejected = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["test"],
        runPromiseExit: async (): Promise<never> =>
          await Promise.reject(rejection),
      });
      await expect(
        queryClient.query(rejected.actions.fail.queryOptions())
      ).rejects.toBe(rejection);
    } finally {
      queryClient.clear();
    }
  });

  it("invalidates HTTP roots, groups, and endpoints independently of overlapping RPC keys", async () => {
    const api = HttpApi.make("cache").add(
      HttpApiGroup.make("users").add(
        HttpApiEndpoint.get("get", "/users/:id", {
          params: { id: Schema.FiniteFromString },
          success: Schema.String,
        }),
        HttpApiEndpoint.get("list", "/users", { success: Schema.String })
      )
    );
    const http = createHttpApiQueryUtils(api, {
      client: Effect.runSync(makeUnusedHttpClient(api)),
      keyPrefix: ["shared"],
    });
    const group = RpcGroup.make(
      Rpc.make("users.get", {
        payload: Schema.Struct({ id: Schema.Finite }),
        success: Schema.String,
      })
    );
    const rpc = createRpcQueryUtils(group, {
      client: () => {
        throw new Error("RPC execution is not used by cache invalidation");
      },
      keyPrefix: ["shared"],
    });
    const queryClient = new QueryClient();
    const first = http.users.get.queryKey({ params: { id: 1 } });
    const second = http.users.get.queryKey({ params: { id: 2 } });
    const other = http.users.list.queryKey();
    const rpcKey = rpc.users.get.queryKey({ id: 1 });
    try {
      for (const key of [first, second, other, rpcKey]) {
        queryClient.setQueryData(key, "cached");
      }
      expect(http.users.get.mutationKey()).not.toStrictEqual(
        http.users.get.queryKey({ params: { id: 1 } })
      );
      await queryClient.invalidateQueries({ queryKey: http.users.get.key() });
      expect({
        first: queryClient.getQueryState(first)?.isInvalidated,
        second: queryClient.getQueryState(second)?.isInvalidated,
        other: queryClient.getQueryState(other)?.isInvalidated,
        rpc: queryClient.getQueryState(rpcKey)?.isInvalidated,
      }).toStrictEqual({ first: true, second: true, other: false, rpc: false });
      await queryClient.invalidateQueries({ queryKey: http.users.key() });
      expect(queryClient.getQueryState(other)?.isInvalidated).toBe(true);
      queryClient.setQueryData(other, "fresh");
      await queryClient.invalidateQueries({ queryKey: http.key() });
      expect({
        other: queryClient.getQueryState(other)?.isInvalidated,
        rpc: queryClient.getQueryState(rpcKey)?.isInvalidated,
      }).toStrictEqual({ other: true, rpc: false });
    } finally {
      queryClient.clear();
    }
  });

  it("requires custom keys for multiple payload alternatives and reports encoder failures", () => {
    const api = HttpApi.make("keys").add(
      HttpApiGroup.make("forms", { topLevel: true }).add(
        HttpApiEndpoint.post("submit", "/submit", {
          payload: [Schema.String, Schema.Finite],
          success: Schema.String,
        })
      )
    );
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    expect(() =>
      createHttpApiQueryUtils(api, {
        client: Effect.runSync(makeUnusedHttpClient(api)),
        keyPrefix: ["test"],
      } as never)
    ).toThrow(expect.objectContaining({ code: "MissingKeyEncoder" }));
    /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    const utils = createHttpApiQueryUtils(api, {
      client: Effect.runSync(makeUnusedHttpClient(api)),
      keyPrefix: ["test"],
      keyEncoders: { forms: { submit: ({ payload }) => ({ payload }) } },
    });
    expect(utils.submit.queryKey({ payload: "yes" })).toStrictEqual([
      "test",
      "http",
      "keys",
      "submit",
      "query",
      { payload: "yes" },
    ]);
    const cause = new Error("encoder");
    const invalid = createHttpApiQueryUtils(api, {
      client: Effect.runSync(makeUnusedHttpClient(api)),
      keyPrefix: ["test"],
      keyEncoders: {
        forms: {
          submit: () => {
            throw cause;
          },
        },
      },
    });
    expect(() => invalid.submit.queryKey({ payload: 1 })).toThrow(
      expect.objectContaining({
        _tag: "EffectHttpApiQueryKeyError",
        code: "KeyEncoderFailed",
        cause,
      })
    );
    expect(() => invalid.submit.queryKey({ payload: 1 })).toThrow(
      EffectHttpApiQueryKeyError
    );
  });

  it("labels all declared request fields in keys and reports synchronous key failures", () => {
    const api = HttpApi.make("labels").add(
      HttpApiGroup.make("users").add(
        HttpApiEndpoint.post("save", "/users/:id", {
          params: { id: Schema.FiniteFromString },
          query: { page: Schema.FiniteFromString },
          headers: { "x-version": Schema.FiniteFromString },
          payload: Schema.Struct({ name: Schema.String }),
        })
      )
    );
    const utils = createHttpApiQueryUtils(api, {
      client: Effect.runSync(makeUnusedHttpClient(api)),
      keyPrefix: ["test"],
    });
    const input = {
      params: { id: 1 },
      query: { page: 2 },
      headers: { "x-version": 3 },
      payload: { name: "Ada" },
    };
    const key = utils.users.save.queryKey(input);
    expect(key.at(-1)).toStrictEqual({
      params: { id: "1" },
      query: { page: "2" },
      headers: { "x-version": "3" },
      payload: { name: "Ada" },
    });
    input.payload.name = "Grace";
    expect(key.at(-1)).toMatchObject({ payload: { name: "Ada" } });
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    expect(() =>
      utils.users.save.queryKey({ ...input, params: { id: "raw" } } as never)
    ).toThrow(
      expect.objectContaining({
        code: "RequestEncodingFailed",
        endpoint: "save",
      })
    );
    /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    const unsafe = createHttpApiQueryUtils(api, {
      client: Effect.runSync(makeUnusedHttpClient(api)),
      keyPrefix: ["test"],
      keyEncoders: { users: { save: () => Number.NaN } },
    });
    expect(() => unsafe.users.save.queryKey(input)).toThrow(
      expect.objectContaining({ code: "InvalidKeyValue" })
    );
  });

  it("rejects empty key prefixes and unknown endpoint encoders", () => {
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    expect(() =>
      createHttpApiQueryUtils(Api, {
        client: Effect.runSync(makeUnusedHttpClient(Api)),
        keyPrefix: [],
      } as never)
    ).toThrow(expect.objectContaining({ code: "InvalidKeyPrefix" }));
    /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    expect(() =>
      createHttpApiQueryUtils(Api, {
        client: Effect.runSync(makeUnusedHttpClient(Api)),
        keyPrefix: ["test"],
        keyEncoders: { users: { missing: () => null } },
      } as never)
    ).toThrow(expect.objectContaining({ code: "UnknownKeyEncoder" }));
    /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
  });
});
