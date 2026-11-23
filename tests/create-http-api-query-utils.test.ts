import { QueryClient } from "@tanstack/query-core";
import {
  Cause,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Schema,
  Scope,
} from "effect";
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
  acquireQueryOwner,
  createContractHydrationRegistry,
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
  it("preserves inherited key prefix getters for utilities and hydration", () => {
    class TenantOptions {
      readonly #tenant = "tenant";

      get keyPrefix() {
        return [this.#tenant] as const;
      }
    }
    const group = RpcGroup.make(Rpc.make("read"));
    const rpc = createRpcQueryUtils(
      group,
      Object.assign(new TenantOptions(), {
        client: { read: () => Effect.void },
      })
    );
    const http = createHttpApiQueryUtils(
      HttpApi.make("empty"),
      Object.assign(new TenantOptions(), { client: {} })
    );
    const registry = createContractHydrationRegistry(
      group,
      new TenantOptions()
    );
    const key = rpc.read.queryKey();
    expect(key).toStrictEqual(["tenant", "rpc", "read", "query"]);
    expect(http.key()).toStrictEqual(["tenant", "http", "empty"]);
    expect(registry.matches(key)).toBe(true);
  });

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
      expect(
        utils.users.get.queryKey({ input: { params: { id: 1 } } })
      ).toStrictEqual([
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
    expect(Object.keys(utils)).toStrictEqual([
      "key",
      "queryFilter",
      "uploads",
      "kept",
    ]);
    expect(Object.keys(utils.uploads)).toStrictEqual([
      "key",
      "queryFilter",
      "upload",
      "brandedUpload",
    ]);
    expect("queryFilter" in utils.uploads.upload).toBe(false);
    expect(utils.uploads.upload.mutationKey()).toStrictEqual([
      "test",
      "http",
      "mixed",
      "uploads",
      "upload",
      "mutation",
    ]);
    expect(Object.keys(utils.kept)).toStrictEqual([
      "key",
      "queryFilter",
      "read",
    ]);
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

  it("omits streaming request bodies, ambiguous stream responses, and protocol upgrades", () => {
    const unsupported = [
      HttpApiEndpoint.post("uploadBytes", "/upload-bytes", {
        payload: HttpApiSchema.StreamUint8Array(),
        success: Schema.String,
      }),
      HttpApiEndpoint.post("uploadNdjson", "/upload-ndjson", {
        payload: HttpApiSchema.StreamNdjson({ schema: Schema.String }),
        success: Schema.String,
      }),
      HttpApiEndpoint.post("mixedUpload", "/mixed-upload", {
        payload: [
          Schema.Struct({ name: Schema.String }),
          HttpApiSchema.StreamNdjson({ schema: Schema.String }),
        ],
        success: Schema.String,
      }),
      HttpApiEndpoint.post("multipartUpload", "/multipart-upload", {
        payload: [
          Schema.Struct({ file: Schema.String }).pipe(
            HttpApiSchema.asMultipart()
          ),
          HttpApiSchema.StreamNdjson({ schema: Schema.String }),
        ],
      }),
      HttpApiEndpoint.post("duplex", "/duplex", {
        payload: HttpApiSchema.StreamUint8Array(),
        success: HttpApiSchema.StreamSse({ data: Schema.String }),
      }),
      HttpApiEndpoint.get("mixedNdjson", "/mixed-ndjson", {
        success: [
          Schema.String,
          HttpApiSchema.StreamNdjson({ schema: Schema.String }),
        ],
      }),
      HttpApiEndpoint.post("multipartNdjson", "/multipart-ndjson", {
        payload: Schema.Struct({ name: Schema.String }).pipe(
          HttpApiSchema.asMultipart()
        ),
        success: HttpApiSchema.StreamNdjson({ schema: Schema.String }),
      }),
      HttpApiEndpoint.get("upgrade", "/upgrade", {
        success: HttpApiSchema.Upgrade({ protocol: "tcp" }),
      }),
    ] as const;
    const api = HttpApi.make("resource-bodies").add(
      HttpApiGroup.make("views").add(
        HttpApiEndpoint.get("read", "/read", { success: Schema.String }),
        HttpApiEndpoint.get("events", "/events", {
          success: HttpApiSchema.StreamSse({ data: Schema.String }),
        }),
        ...unsupported
      ),
      HttpApiGroup.make("omitted").add(...unsupported)
    );
    const utils = createHttpApiQueryUtils(api, {
      client: Effect.runSync(makeUnusedHttpClient(api)),
      keyPrefix: ["test"],
    });
    expect(Object.keys(utils)).toStrictEqual(["key", "queryFilter", "views"]);
    expect(Object.keys(utils.views)).toStrictEqual([
      "key",
      "queryFilter",
      "read",
      "events",
    ]);
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
    } finally {
      queryClient.clear();
    }
  });

  it.each(["call", "effect", "queryFilter"])(
    "rejects %s as an HTTP group or endpoint",
    (segment) => {
      const nested = HttpApi.make("invalid").add(
        HttpApiGroup.make(segment).add(HttpApiEndpoint.get("read", "/read"))
      );
      const topLevel = HttpApi.make("invalid").add(
        HttpApiGroup.make("root", { topLevel: true }).add(
          HttpApiEndpoint.get(segment, "/read")
        )
      );
      const nestedClient = Effect.runSync(makeUnusedHttpClient(nested));
      const topLevelClient = Effect.runSync(makeUnusedHttpClient(topLevel));
      expect(() =>
        createHttpApiQueryUtils(nested, { client: nestedClient })
      ).toThrow(expect.objectContaining({ code: "InvalidEndpointPath" }));
      expect(() =>
        createHttpApiQueryUtils(topLevel, { client: topLevelClient })
      ).toThrow(expect.objectContaining({ code: "InvalidEndpointPath" }));
    }
  );

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

  it("preserves the complete failed Cause", async () => {
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
    const first = http.users.get.queryKey({ input: { params: { id: 1 } } });
    const second = http.users.get.queryKey({ input: { params: { id: 2 } } });
    const other = http.users.list.queryKey();
    const rpcKey = rpc.users.get.queryKey({ input: { id: 1 } });
    try {
      for (const key of [first, second, other, rpcKey]) {
        queryClient.setQueryData(key, "cached");
      }
      expect(http.users.get.mutationKey()).not.toStrictEqual(
        http.users.get.queryKey({ input: { params: { id: 1 } } })
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
    expect(utils.submit.queryKey({ input: { payload: "yes" } })).toStrictEqual([
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
    expect(() => invalid.submit.queryKey({ input: { payload: 1 } })).toThrow(
      expect.objectContaining({
        _tag: "EffectHttpApiQueryKeyError",
        code: "KeyEncoderFailed",
        cause,
      })
    );
    expect(() => invalid.submit.queryKey({ input: { payload: 1 } })).toThrow(
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
    const key = utils.users.save.queryKey({ input });
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
      utils.users.save.queryKey({
        input: { ...input, params: { id: "raw" } },
      } as never)
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
    expect(() => unsafe.users.save.queryKey({ input })).toThrow(
      expect.objectContaining({ code: "InvalidKeyValue" })
    );
  });

  it("rejects empty key prefixes", () => {
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    expect(() =>
      createHttpApiQueryUtils(Api, {
        client: Effect.runSync(makeUnusedHttpClient(Api)),
        keyPrefix: [],
      } as never)
    ).toThrow(expect.objectContaining({ code: "InvalidKeyPrefix" }));
    /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
  });

  it("omits keyPrefix to produce ['http', api.identifier] roots and supports ManagedRuntime and object runtimes", async () => {
    const managed = ManagedRuntime.make(Layer.empty);
    const queryClient = new QueryClient();
    try {
      const client = await Effect.runPromise(Effect.scoped(makeClient));
      const unprefixed = createHttpApiQueryUtils(Api, {
        client,
        runtime: managed,
      });
      const fetched = await queryClient.query(
        unprefixed.users.get.queryOptions({ input: { params: { id: 5 } } })
      );
      expect({
        rootKey: unprefixed.key(),
        queryKey: unprefixed.users.get.queryKey({
          input: { params: { id: 5 } },
        }),
        fetched,
      }).toStrictEqual({
        rootKey: ["http", "test"],
        queryKey: [
          "http",
          "test",
          "users",
          "get",
          "query",
          { params: { id: "5" } },
        ],
        fetched: { id: 5, name: "Ada" },
      });

      /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
      expect(() =>
        createHttpApiQueryUtils(Api, {
          client,
          keyPrefix: undefined,
        } as never)
      ).toThrow(expect.objectContaining({ code: "InvalidKeyPrefix" }));
      /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */

      let observedTag: string | undefined;
      const objectRuntime = {
        tag: "http-object-runtime",
        async runPromiseExit<A, E>(
          this: { readonly tag: string },
          effect: Effect.Effect<A, E>,
          options?: { readonly signal?: AbortSignal }
        ) {
          observedTag = this.tag;
          return await Effect.runPromiseExit(effect, options);
        },
      };
      const withReceiver = createHttpApiQueryUtils(Api, {
        client,
        runtime: objectRuntime,
      });
      const metadata = await queryClient.query(
        withReceiver.users.get.metadataOptions({ input: { params: { id: 6 } } })
      );
      expect({ data: metadata.data, observedTag }).toStrictEqual({
        data: { id: 6, name: "Ada" },
        observedTag: "http-object-runtime",
      });

      const owner = await acquireQueryOwner(
        async (setup) => await Promise.resolve(setup.trackUtils(unprefixed))
      );
      const trackedMeta = await owner.queryClient.query(
        owner.resources.users.get.metadataOptions({
          input: { params: { id: 7 } },
        })
      );
      expect(trackedMeta.data).toStrictEqual({ id: 7, name: "Ada" });
      await owner.dispose();
      await expect(
        owner.queryClient.query(
          owner.resources.users.get.metadataOptions({
            input: { params: { id: 8 } },
            retry: false,
          })
        )
      ).rejects.toThrow("retired");
    } finally {
      queryClient.clear();
      await managed.dispose();
    }
  });
});
