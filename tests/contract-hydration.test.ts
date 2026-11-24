import { describe, it } from "@effect/vitest";
import { dehydrate, hydrate, QueryClient } from "@tanstack/query-core";
import {
  Context,
  Effect,
  Function,
  Layer,
  ManagedRuntime,
  Predicate,
  Redacted,
  Schema,
  SchemaParser,
  SchemaTransformation,
  Stream,
} from "effect";
import { Sse } from "effect/encoding";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import { expect } from "vite-plus/test";

import {
  createContractHydrationRegistry,
  createHttpApiQueryUtils,
  createHydrationRegistry,
  createRpcQueryUtils,
  HydrationCodecError,
  queryViewCodec,
} from "#effect-api-query";
import type { HydrationRegistry } from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc.ts";
import { Profile } from "./types/docs-hydration-rich.ts";
import { Cursor } from "./types/docs-hydration-views.ts";

const profile = new Profile({
  name: "Ada",
  credits: 23n,
  avatar: new Uint8Array([0, 128, 255]),
});

const DiagnosticEvent = Schema.Struct({
  __effectApiQueryHydration: Schema.Literal("undefined"),
});
const diagnosticEvent = DiagnosticEvent.make({
  __effectApiQueryHydration: "undefined",
});

const captureHydrationError = (fn: () => void): HydrationCodecError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof HydrationCodecError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected HydrationCodecError");
};

const parseSnapshot = (json: string) => {
  // oxlint-disable-next-line typescript/no-unsafe-assignment
  const wire: ReturnType<typeof dehydrate> = JSON.parse(json);
  return wire;
};

const roundTripJson = Effect.fnUntraced(function* roundTripJson(
  registry: HydrationRegistry,
  server: QueryClient,
  browser: QueryClient
) {
  const snapshot = dehydrate(server, {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: (query) =>
      query.state.status === "success" && registry.matches(query.queryKey),
  });
  const encoded = yield* registry.encodeQueries(snapshot.queries);
  const json = JSON.stringify({ ...snapshot, queries: encoded });
  const wire = parseSnapshot(json);
  const decoded = yield* registry.decodeQueries(wire.queries);
  hydrate(browser, { ...wire, queries: decoded });
});

const dummyHttpClient = HttpClient.make((request) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }))
  )
);

class DecodeSvc extends Context.Service<DecodeSvc, { readonly tag: string }>()(
  "ComposeDecodeSvc"
) {}

describe("createContractHydrationRegistry — RPC contracts", () => {
  it.effect("preserves nested union members and built-in JSON schemas", () =>
    Effect.gen(function* preservesNestedUnionMembers() {
      const Value = Schema.Union([Schema.BigInt, Schema.String]);
      const Nested = Schema.Struct({
        optional: Schema.optionalKey(Value),
        values: Schema.Array(Value),
        dictionary: Schema.Record(Schema.String, Value),
        json: Schema.Json,
        jsonObject: Schema.JsonObject,
      });
      const group = RpcGroup.make(Rpc.make("read", { success: Nested }));
      const key = ["rpc", "read", "query"];
      const value = Nested.make({
        values: ["42", 42n],
        dictionary: { text: "42", bigint: 42n },
        json: [null, { count: 1 }],
        jsonObject: { count: 1 },
      });
      const server = new QueryClient();
      const browser = new QueryClient();
      const registry = createContractHydrationRegistry(group);
      server.setQueryData(key, value);
      yield* roundTripJson(registry, server, browser);
      expect(browser.getQueryData(key)).toStrictEqual(value);
      const withOptional = Nested.make({ ...value, optional: "42" });
      server.setQueryData(key, withOptional);
      browser.clear();
      yield* roundTripJson(registry, server, browser);
      expect(browser.getQueryData(key)).toStrictEqual(withOptional);
    })
  );

  it("rejects unrestricted Any before serializing a stream", () => {
    const group = RpcGroup.make(
      Rpc.make("watch", { success: Schema.Any, stream: true })
    );
    expect(() => createContractHydrationRegistry(group)).toThrow(
      expect.objectContaining({ code: "UnencodableSchema", path: "watch" })
    );
  });

  it.effect(
    "preserves RPC union members in query, live, and streamed data",
    () =>
      Effect.gen(function* preservesRpcUnionMembers() {
        const Value = Schema.Union([
          Schema.BigInt,
          Schema.String,
          Schema.Undefined,
          Schema.Null,
        ]);
        const group = RpcGroup.make(
          Rpc.make("read", { success: Value }),
          Rpc.make("watch", { success: Value, stream: true })
        );
        const client = yield* makeRpcTestClient(group, {
          read: () => Effect.succeed("42"),
          watch: () => Stream.make(42n, undefined, null, "42"),
        });
        const { read, watch } = createRpcQueryUtils(group, { client });
        const query = read.queryOptions();
        const live = watch.liveOptions();
        const streamed = watch.streamedOptions({ maxChunks: 4 });
        const server = new QueryClient();
        const browser = new QueryClient();
        yield* Effect.promise(async () => await server.query(query));
        server.setQueryData(live.queryKey, "42");
        server.setQueryData(streamed.queryKey, [42n, undefined, null, "42"]);
        yield* roundTripJson(
          createContractHydrationRegistry(group),
          server,
          browser
        );
        expect([
          browser.getQueryData(query.queryKey),
          browser.getQueryData(live.queryKey),
          browser.getQueryData(streamed.queryKey),
        ]).toStrictEqual(["42", "42", [42n, undefined, null, "42"]]);
      })
  );

  it.effect(
    "round-trips unary, void, optional, infinite, live, and streamed RPC views with default empty keyPrefix",
    () =>
      Effect.gen(function* roundTripsRpcViews() {
        const OptionalName: Schema.Codec<string | undefined> = Schema.suspend(
          () => Schema.Union([Schema.String, Schema.Undefined, OptionalName])
        );
        const group = RpcGroup.make(
          Rpc.make("users.read", {
            payload: { id: Schema.Int },
            success: Profile,
          }),
          Rpc.make("health.ping", { success: Schema.Void }),
          Rpc.make("users.optional", {
            payload: { id: Schema.Int },
            success: OptionalName,
          }),
          Rpc.make("events.watch", {
            success: Schema.Union([
              Profile,
              Schema.Undefined,
              Schema.Null,
              DiagnosticEvent,
            ]),
            stream: true,
          })
        );
        const client = yield* makeRpcTestClient(group, {
          "users.read": () => Effect.succeed(profile),
          "health.ping": () => Effect.void,
          "users.optional": ({ id }) =>
            Effect.succeed(id === 1 ? undefined : "Ada"),
          "events.watch": () =>
            Stream.fromIterable([profile, diagnosticEvent, undefined, null]),
        });
        const rpc = createRpcQueryUtils(group, { client });
        const registry = createContractHydrationRegistry(group, {
          paths: {
            "users.read": {
              infinite: { pageParam: Cursor },
            },
          },
        });
        const server = new QueryClient();
        const browser = new QueryClient();
        try {
          const readOpts = rpc.users.read.queryOptions({
            input: { id: 1 },
            staleTime: Infinity,
          });
          const pingOpts = rpc.health.ping.queryOptions({
            staleTime: Infinity,
          });
          const optOpts = rpc.users.optional.queryOptions({
            input: { id: 1 },
            staleTime: Infinity,
          });
          const namedOpts = rpc.users.optional.queryOptions({
            input: { id: 2 },
            staleTime: Infinity,
          });
          const infOpts = rpc.users.read.infiniteOptions({
            initialPageParam: new Cursor({ offset: 0n }),
            input: (cursor) => ({ id: Number(cursor.offset) }),
            getNextPageParam: () => null,
            staleTime: Infinity,
          });
          const streamedOpts = rpc.events.watch.streamedOptions({
            maxChunks: "unbounded",
            staleTime: Infinity,
          });
          const liveOpts = rpc.events.watch.liveOptions({
            staleTime: Infinity,
          });

          yield* Effect.promise(async () => await server.query(readOpts));
          yield* Effect.promise(async () => await server.query(pingOpts));
          yield* Effect.promise(async () => await server.query(optOpts));
          yield* Effect.promise(async () => await server.query(namedOpts));
          yield* Effect.promise(
            async () => await server.infiniteQuery(infOpts)
          );
          yield* Effect.promise(async () => await server.query(streamedOpts));
          yield* Effect.promise(async () => await server.query(liveOpts));

          yield* roundTripJson(registry, server, browser);

          const restoredRead = browser.getQueryData(readOpts.queryKey);
          const restoredPages = browser.getQueryData(infOpts.queryKey);

          /* oxlint-disable typescript/no-unsafe-assignment */
          expect({
            read: restoredRead,
            credits: restoredRead?.credits,
            avatar: restoredRead?.avatar,
            ping: browser.getQueryData(pingOpts.queryKey),
            optional: browser.getQueryData(optOpts.queryKey),
            named: browser.getQueryData(namedOpts.queryKey),
            page: restoredPages?.pages[0],
            cursor: restoredPages?.pageParams[0],
            offset: restoredPages?.pageParams[0]?.offset,
            streamed: browser.getQueryData(streamedOpts.queryKey),
            live: browser.getQueryData(liveOpts.queryKey),
          }).toStrictEqual({
            read: expect.any(Profile),
            credits: 23n,
            avatar: new Uint8Array([0, 128, 255]),
            ping: null,
            optional: null,
            named: "Ada",
            page: expect.any(Profile),
            cursor: expect.any(Cursor),
            offset: 0n,
            streamed: [expect.any(Profile), diagnosticEvent, undefined, null],
            live: null,
          });
          /* oxlint-enable typescript/no-unsafe-assignment */
        } finally {
          server.clear();
          browser.clear();
        }
      })
  );

  it.effect(
    "supports keyPrefix, top-level views toggles, per-path false opt-outs, and custom query override inheritance into infinite.page",
    () =>
      Effect.gen(function* supportsRpcOptionsAndOverrides() {
        const CustomString = Schema.String.pipe(
          Schema.decodeTo(
            Schema.String,
            SchemaTransformation.transform({
              decode: (value) => value.replace(/^custom:/u, ""),
              encode: (value) => `custom:${value}`,
            })
          )
        );
        const group = RpcGroup.make(
          Rpc.make("items.get", { success: Schema.String }),
          Rpc.make("items.skip", { success: Schema.String }),
          Rpc.make("events.feed", { success: Schema.String, stream: true })
        );
        const client = yield* makeRpcTestClient(group, {
          "items.get": () => Effect.succeed("hello"),
          "items.skip": () => Effect.succeed("skipped"),
          "events.feed": () => Stream.fromIterable(["a", "b"]),
        });
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["tenant-a"],
        });
        const registry = createContractHydrationRegistry(group, {
          keyPrefix: ["tenant-a"],
          views: { streamed: false },
          paths: {
            "items.get": {
              query: CustomString,
              infinite: { pageParam: Schema.Int },
            },
            "items.skip": false,
          },
        });

        expect({
          query: registry.matches(rpc.items.get.queryKey()),
          infinite: registry.matches(rpc.items.get.infiniteKey()),
          skipped: registry.matches(rpc.items.skip.queryKey()),
          live: registry.matches(rpc.events.feed.liveKey()),
          streamed: registry.matches(
            rpc.events.feed.streamedKey({ maxChunks: 5 })
          ),
        }).toStrictEqual({
          query: true,
          infinite: true,
          skipped: false,
          live: true,
          streamed: false,
        });

        const server = new QueryClient();
        const browser = new QueryClient();
        try {
          const infOpts = rpc.items.get.infiniteOptions({
            initialPageParam: 1,
            getNextPageParam: () => null,
          });
          yield* Effect.promise(
            async () => await server.infiniteQuery(infOpts)
          );
          const snapshot = dehydrate(server);
          const encoded = yield* registry.encodeQueries(snapshot.queries);
          const decoded = yield* registry.decodeQueries(encoded);
          hydrate(browser, { ...snapshot, queries: decoded });
          expect({
            encoded: encoded[0]?.state.data,
            decoded: browser.getQueryData(infOpts.queryKey),
          }).toStrictEqual({
            encoded: { pages: ["custom:hello"], pageParams: [1] },
            decoded: { pages: ["hello"], pageParams: [1] },
          });
        } finally {
          server.clear();
          browser.clear();
        }
      })
  );
});

describe("createContractHydrationRegistry — HTTP contracts", () => {
  it.effect("preserves HTTP success variants with the same JSON encoding", () =>
    Effect.gen(function* preservesHttpSuccessVariants() {
      const api = HttpApi.make("variants").add(
        HttpApiGroup.make("values").add(
          HttpApiEndpoint.get("read", "/value", {
            success: [
              HttpApiSchema.status(200)(Schema.BigInt),
              HttpApiSchema.status(201)(Schema.String),
            ],
          })
        )
      );
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: "https://example.test",
        httpClient: dummyHttpClient,
      });
      const { read } = createHttpApiQueryUtils(api, { client }).values;
      const queryKey = read.queryKey();
      const metadataKey = read.metadataKey();
      const server = new QueryClient();
      const browser = new QueryClient();
      server.setQueryData(queryKey, "42");
      server.setQueryData(metadataKey, { data: 42n, status: 200, headers: {} });
      yield* roundTripJson(
        createContractHydrationRegistry(api, {
          views: { metadata: { headers: [] } },
        }),
        server,
        browser
      );
      expect(browser.getQueryData(queryKey)).toBe("42");
      expect(browser.getQueryData(metadataKey)?.data).toBe(42n);
    })
  );

  it.effect(
    "preserves overlapping HTTP success shapes in query and metadata data",
    () =>
      Effect.gen(function* preservesOverlappingHttpSuccesses() {
        const api = HttpApi.make("overlapping").add(
          HttpApiGroup.make("values").add(
            HttpApiEndpoint.get("read", "/value", {
              success: [
                HttpApiSchema.status(200)(Schema.Struct({ id: Schema.Int })),
                HttpApiSchema.status(201)(
                  Schema.Struct({ id: Schema.Int, flag: Schema.Boolean })
                ),
              ],
            })
          )
        );
        const httpClient = HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({ id: 1, flag: true }, { status: 201 })
            )
          )
        );
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient,
        });
        const { read } = createHttpApiQueryUtils(api, { client }).values;
        const query = read.queryOptions();
        const metadata = read.metadataOptions();
        const server = new QueryClient();
        const browser = new QueryClient();
        const queryData = yield* Effect.promise(
          async () => await server.query(query)
        );
        const metadataData = yield* Effect.promise(
          async () => await server.query(metadata)
        );
        yield* roundTripJson(
          createContractHydrationRegistry(api, {
            views: { metadata: { headers: ["content-type"] } },
          }),
          server,
          browser
        );
        expect(queryData).toStrictEqual({ id: 1, flag: true });
        expect(metadataData.status).toBe(201);
        expect({
          data: browser.getQueryData(query.queryKey),
          metadata: browser.getQueryData(metadata.queryKey),
        }).toStrictEqual({ data: queryData, metadata: metadataData });
      })
  );

  it.effect(
    "uses only the HTTP success codecs for the cached metadata status",
    () =>
      Effect.gen(function* usesMetadataStatus() {
        const Unselected = Schema.String.pipe(
          Schema.middlewareEncoding(() => Effect.die("unexpected 200 encoder"))
        );
        const api = HttpApi.make("statuses").add(
          HttpApiGroup.make("values").add(
            HttpApiEndpoint.get("read", "/value", {
              success: [Unselected, HttpApiSchema.status(201)(Schema.String)],
            })
          )
        );
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: dummyHttpClient,
        });
        const key = createHttpApiQueryUtils(api, {
          client,
        }).values.read.metadataKey();
        const server = new QueryClient();
        const browser = new QueryClient();
        const metadata = {
          data: "created",
          status: 201,
          headers: { etag: "1" },
        };
        server.setQueryData(key, metadata);
        yield* roundTripJson(
          createContractHydrationRegistry(api, {
            views: { metadata: { headers: ["etag"] } },
          }),
          server,
          browser
        );
        expect(browser.getQueryData(key)).toStrictEqual(metadata);
      })
  );

  it.effect(
    "derives HTTP success codecs without inspecting middleware errors",
    () =>
      Effect.gen(function* ignoresMiddlewareErrors() {
        const detail = Symbol("detail");
        const Authorization = HttpApiMiddleware.Service<never>()(
          "ContractHydration/Authorization",
          { error: Schema.Struct({ [detail]: Schema.String }) }
        );
        const api = HttpApi.make("middleware-errors").add(
          HttpApiGroup.make("values").add(
            HttpApiEndpoint.get("read", "/value", {
              success: [
                Schema.BigInt,
                HttpApiSchema.status(201)(Schema.String),
              ],
            }).middleware(Authorization)
          )
        );
        const queryKey = [
          "http",
          "middleware-errors",
          "values",
          "read",
          "query",
        ];
        const metadataKey = [
          "http",
          "middleware-errors",
          "values",
          "read",
          "metadata",
        ];
        const metadata = { data: "42", status: 201, headers: {} };
        const server = new QueryClient();
        const browser = new QueryClient();
        server.setQueryData(queryKey, 42n);
        server.setQueryData(metadataKey, metadata);
        yield* roundTripJson(
          createContractHydrationRegistry(api, {
            views: { metadata: { headers: ["content-type"] } },
          }),
          server,
          browser
        );
        expect(browser.getQueryData(queryKey)).toBe(42n);
        expect(browser.getQueryData(metadataKey)).toStrictEqual(metadata);
      })
  );

  it.effect(
    "preserves top-level union members within one or several HTTP success declarations",
    () =>
      Effect.gen(function* preservesHttpUnionMembers() {
        const Union = Schema.Union([Schema.BigInt, Schema.String]);
        const api = HttpApi.make("unions").add(
          HttpApiGroup.make("values").add(
            HttpApiEndpoint.get("single", "/single", { success: Union }),
            HttpApiEndpoint.get("multiple", "/multiple", {
              success: [Union, HttpApiSchema.status(201)(Schema.Boolean)],
            })
          )
        );
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: dummyHttpClient,
        });
        const { single, multiple } = createHttpApiQueryUtils(api, {
          client,
        }).values;
        const server = new QueryClient();
        const browser = new QueryClient();
        server.setQueryData(single.queryKey(), "42");
        server.setQueryData(multiple.queryKey(), "42");
        server.setQueryData(single.metadataKey(), {
          data: "42",
          status: 200,
          headers: {},
        });
        server.setQueryData(multiple.metadataKey(), {
          data: 42n,
          status: 200,
          headers: {},
        });
        yield* roundTripJson(
          createContractHydrationRegistry(api, {
            views: { metadata: { headers: ["content-type"] } },
          }),
          server,
          browser
        );
        expect([
          browser.getQueryData(single.queryKey()),
          browser.getQueryData(multiple.queryKey()),
          browser.getQueryData(single.metadataKey())?.data,
          browser.getQueryData(multiple.metadataKey())?.data,
        ]).toStrictEqual(["42", "42", "42", 42n]);
      })
  );

  it.effect("preserves union members in HTTP NDJSON and SSE data views", () =>
    Effect.gen(function* preservesHttpStreamUnionMembers() {
      const Value = Schema.Union([Schema.BigInt, Schema.String]);
      const api = HttpApi.make("stream-unions").add(
        HttpApiGroup.make("values").add(
          HttpApiEndpoint.get("ndjson", "/ndjson", {
            success: HttpApiSchema.StreamNdjson({ schema: Value }),
          }),
          HttpApiEndpoint.get("sse", "/sse", {
            success: HttpApiSchema.WithHeaders(
              HttpApiSchema.StreamSse({ data: Value }),
              { "x-stream-id": Schema.String }
            ),
          })
        )
      );
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: "https://example.test",
        httpClient: dummyHttpClient,
      });
      const { ndjson, sse } = createHttpApiQueryUtils(api, { client }).values;
      const server = new QueryClient();
      const browser = new QueryClient();
      const wrapped = HttpApiSchema.withHeaders({
        body: "42",
        headers: { "x-stream-id": "s-1" },
      });
      const ndjsonStreamed = ndjson.streamedKey({ maxChunks: 4 });
      const ndjsonLive = ndjson.liveKey();
      const sseStreamed = sse.streamedKey({ maxChunks: 4 });
      const sseLive = sse.liveKey();
      server.setQueryData(ndjsonStreamed, [42n, "42"]);
      server.setQueryData(ndjsonLive, "42");
      server.setQueryData(sseStreamed, [wrapped]);
      server.setQueryData(sseLive, wrapped);
      yield* roundTripJson(
        createContractHydrationRegistry(api, {
          views: { metadata: { headers: [] } },
        }),
        server,
        browser
      );
      expect([
        browser.getQueryData(ndjsonStreamed),
        browser.getQueryData(ndjsonLive),
        browser.getQueryData(sseStreamed),
        browser.getQueryData(sseLive),
      ]).toStrictEqual([[42n, "42"], "42", [wrapped], wrapped]);
    })
  );

  it.effect("preserves a transformed SSE data codec's encoded union", () =>
    Effect.gen(function* preservesTransformedSseData() {
      const Value = Schema.Union([Schema.BigInt, Schema.String]);
      const Data = Value.pipe(
        Schema.decodeTo(
          Schema.Struct({ value: Value }),
          SchemaTransformation.transform({
            decode: (value) => ({ value }),
            encode: ({ value }) => value,
          })
        )
      );
      const api = HttpApi.make("sse-encoded-union").add(
        HttpApiGroup.make("events").add(
          HttpApiEndpoint.get("watch", "/events", {
            success: HttpApiSchema.StreamSse({ data: Data }),
          })
        )
      );
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: "https://example.test",
        httpClient: dummyHttpClient,
      });
      const { watch } = createHttpApiQueryUtils(api, { client }).events;
      const live = watch.liveKey();
      const streamed = watch.streamedKey({ maxChunks: 3 });
      const server = new QueryClient();
      const browser = new QueryClient();
      server.setQueryData(live, { value: "42" });
      server.setQueryData(streamed, [{ value: 42n }, { value: "42" }]);
      yield* roundTripJson(
        createContractHydrationRegistry(api, {
          views: { metadata: { headers: [] } },
        }),
        server,
        browser
      );
      expect(browser.getQueryData(live)).toStrictEqual({ value: "42" });
      expect(browser.getQueryData(streamed)).toStrictEqual([
        { value: 42n },
        { value: "42" },
      ]);
    })
  );

  it("honors top-level view toggles supplied by getters and non-enumerable properties", () => {
    const success = Schema.String.pipe(
      Schema.middlewareDecoding((decode) =>
        DecodeSvc.pipe(Effect.andThen(decode))
      )
    );
    const group = RpcGroup.make(Rpc.make("read", { success }));
    const views = { query: false } as const;
    const inheritedOptions = { views };
    Object.setPrototypeOf(inheritedOptions, {
      get views() {
        return views;
      },
    });
    Reflect.deleteProperty(inheritedOptions, "views");
    Object.defineProperty(views, "query", { enumerable: false });

    for (const options of [inheritedOptions, { views }]) {
      const registry: HydrationRegistry = createContractHydrationRegistry(
        group,
        options
      );
      expect(registry.matches(["rpc", "read", "query"])).toBe(false);
    }
  });

  it("honors a top-level paths getter on RPC and HTTP hydration options", () => {
    const success = Schema.String.pipe(
      Schema.middlewareDecoding((decode) =>
        DecodeSvc.pipe(Effect.andThen(decode))
      )
    );
    const group = RpcGroup.make(Rpc.make("read", { success }));
    const api = HttpApi.make("getter-paths").add(
      HttpApiGroup.make("values", { topLevel: true }).add(
        HttpApiEndpoint.get("read", "/value", { success })
      )
    );
    const prototype = {
      get paths() {
        return { read: false } as const;
      },
    };
    const options = { paths: prototype.paths };
    Object.setPrototypeOf(options, prototype);
    Reflect.deleteProperty(options, "paths");
    const rpc: HydrationRegistry = createContractHydrationRegistry(
      group,
      options
    );
    const http: HydrationRegistry = createContractHydrationRegistry(
      api,
      options
    );
    expect([
      rpc.matches(["rpc", "read", "query"]),
      http.matches(["http", "getter-paths", "read", "query"]),
      http.matches(["http", "getter-paths", "read", "metadata"]),
    ]).toStrictEqual([false, false, false]);
  });

  it("reads each own hydration view override once", () => {
    const group = RpcGroup.make(Rpc.make("read", { success: Schema.String }));
    let reads = 0;
    const registry = createContractHydrationRegistry(group, {
      paths: {
        read: {
          get query() {
            reads += 1;
            return reads === 1 ? false : undefined;
          },
        },
      },
    });

    expect(reads).toBe(1);
    expect(registry.matches(["rpc", "read", "query"])).toBe(false);
  });

  it("ignores inherited view overrides on accepted RPC and HTTP paths", () => {
    const group = RpcGroup.make(Rpc.make("read", { success: Schema.String }));
    const api = HttpApi.make("own-views").add(
      HttpApiGroup.make("values", { topLevel: true }).add(
        HttpApiEndpoint.get("read", "/value", { success: Schema.String })
      )
    );
    const inherited = {
      query: false,
      infinite: { pageParam: Schema.Int },
    };
    const config = {};
    Object.setPrototypeOf(config, { ...inherited, metadata: false });
    const options = { paths: { read: config } };
    const rpcRegistry = createContractHydrationRegistry(group, options);
    const httpRegistry = createContractHydrationRegistry(api, {
      views: { metadata: { headers: [] } },
      ...options,
    });
    expect([
      rpcRegistry.matches(["rpc", "read", "query"]),
      httpRegistry.matches(["http", "own-views", "read", "query"]),
      httpRegistry.matches(["http", "own-views", "read", "metadata"]),
      rpcRegistry.matches(["rpc", "read", "infinite"]),
      httpRegistry.matches(["http", "own-views", "read", "infinite"]),
    ]).toStrictEqual([true, true, true, false, false]);
  });

  it("reads hydration overrides only from own path properties", () => {
    const group = RpcGroup.make(
      Rpc.make("toString", { success: Schema.String })
    );
    const api = HttpApi.make("inherited").add(
      HttpApiGroup.make("root", { topLevel: true }).add(
        HttpApiEndpoint.get("toString", "/text", { success: Schema.String })
      )
    );

    const rpcKey = ["rpc", "toString", "query"];
    const httpKey = ["http", "inherited", "toString", "query"];
    expect(createContractHydrationRegistry(group).matches(rpcKey)).toBe(true);
    expect(createContractHydrationRegistry(api).matches(httpKey)).toBe(true);
    expect(
      createContractHydrationRegistry(group, {
        paths: { toString: false },
      }).matches(rpcKey)
    ).toBe(false);
    expect(
      createContractHydrationRegistry(api, {
        paths: { toString: false },
      }).matches(httpKey)
    ).toBe(false);
  });

  it.effect(
    "round-trips buffered, frozen metadata, Text, FormUrlEncoded, Uint8Array, disableCodecs, WithHeaders, encodeToWithHeaders, and multi-success unions",
    () =>
      Effect.gen(function* roundTripsHttpBufferedEncodings() {
        const ProfileWithEncodedHeaders = Profile.pipe(
          HttpApiSchema.encodeToWithHeaders(
            {
              body: Schema.Struct({
                name: Schema.String,
                avatar: Schema.Uint8Array,
              }),
              headers: { "x-credits": Schema.BigInt },
            },
            {
              decode: ({ body, headers }) =>
                new Profile({
                  name: body.name,
                  credits: headers["x-credits"],
                  avatar: body.avatar,
                }),
              encode: (value) => ({
                body: { name: value.name, avatar: value.avatar },
                headers: { "x-credits": value.credits },
              }),
            }
          )
        );

        const api = HttpApi.make("hydration-http")
          .add(
            HttpApiGroup.make("root", { topLevel: true }).add(
              HttpApiEndpoint.get("ping", "/ping", {
                success: HttpApiSchema.NoContent,
              })
            )
          )
          .add(
            HttpApiGroup.make("data").add(
              HttpApiEndpoint.get("json", "/json", { success: Profile }),
              HttpApiEndpoint.get("text", "/text", {
                success: Schema.String.pipe(HttpApiSchema.asText()),
              }),
              HttpApiEndpoint.get("form", "/form", {
                success: Schema.Struct({
                  page: Schema.FiniteFromString,
                  tag: Schema.String,
                }).pipe(HttpApiSchema.asFormUrlEncoded()),
              }),
              HttpApiEndpoint.get("bytes", "/bytes", {
                success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
              }),
              HttpApiEndpoint.get("raw", "/raw", {
                success: Profile,
                disableCodecs: true,
              }),
              HttpApiEndpoint.get("wrapped", "/wrapped", {
                success: HttpApiSchema.WithHeaders(Profile, {
                  "x-version": Schema.FiniteFromString,
                }),
              }),
              HttpApiEndpoint.get("wrappedEmpty", "/wrapped-empty", {
                success: HttpApiSchema.WithHeaders(HttpApiSchema.NoContent, {
                  "x-etag": Schema.String,
                }),
              }),
              HttpApiEndpoint.get("encodedHeaders", "/encoded-headers", {
                success: ProfileWithEncodedHeaders,
              }),
              HttpApiEndpoint.get("multi", "/multi", {
                success: [
                  HttpApiSchema.NoContent,
                  HttpApiSchema.status(200)(Profile),
                ],
              }),
              HttpApiEndpoint.post("upload", "/upload", {
                payload: Schema.Struct({ file: Schema.String }).pipe(
                  HttpApiSchema.asMultipart()
                ),
                success: Schema.String,
              }),
              HttpApiEndpoint.get("binaryStream", "/binary-stream", {
                success: HttpApiSchema.StreamUint8Array(),
              }),
              HttpApiEndpoint.get("upgrade", "/upgrade", {
                success: HttpApiSchema.Upgrade({ protocol: "tcp" }),
              })
            )
          );

        const responses = new Map<string, () => Response>([
          ["/ping", () => new Response(null, { status: 204 })],
          [
            "/json",
            () =>
              Response.json(Schema.encodeSync(Profile)(profile), {
                headers: { "x-source": "server" },
              }),
          ],
          [
            "/raw",
            () =>
              Response.json(Schema.encodeSync(Profile)(profile), {
                headers: { "x-source": "server" },
              }),
          ],
          [
            "/text",
            () =>
              new Response("plain text", {
                headers: { "content-type": "text/plain" },
              }),
          ],
          [
            "/form",
            () =>
              new Response("page=4&tag=ok", {
                headers: {
                  "content-type": "application/x-www-form-urlencoded",
                },
              }),
          ],
          [
            "/bytes",
            () =>
              new Response(new Uint8Array([1, 2, 3, 255]), {
                headers: { "content-type": "application/octet-stream" },
              }),
          ],
          [
            "/wrapped",
            () =>
              Response.json(Schema.encodeSync(Profile)(profile), {
                headers: { "x-version": "9", etag: "v9" },
              }),
          ],
          [
            "/wrapped-empty",
            () =>
              new Response(null, {
                status: 204,
                headers: { "x-etag": "empty-tag" },
              }),
          ],
          [
            "/encoded-headers",
            () => {
              const encodedProfile = Schema.encodeSync(Profile)(profile);
              return Response.json(
                { name: encodedProfile.name, avatar: encodedProfile.avatar },
                { headers: { "x-credits": "23" } }
              );
            },
          ],
          [
            "/multi",
            () =>
              Response.json(Schema.encodeSync(Profile)(profile), {
                status: 200,
              }),
          ],
        ]);

        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: HttpClient.make((request) => {
            const { pathname } = new URL(request.url);
            const build = responses.get(pathname);
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                build === undefined
                  ? new Response(null, { status: 404 })
                  : build()
              )
            );
          }),
        });

        const http = createHttpApiQueryUtils(api, { client });
        const registry = createContractHydrationRegistry(api, {
          views: { metadata: { headers: ["x-source", "etag"] } },
        });

        const server = new QueryClient();
        const browser = new QueryClient();
        try {
          yield* Effect.promise(
            async () => await server.query(http.ping.queryOptions())
          );
          yield* Effect.promise(
            async () => await server.query(http.data.json.queryOptions())
          );
          yield* Effect.promise(
            async () => await server.query(http.data.json.metadataOptions())
          );
          yield* Effect.promise(
            async () => await server.query(http.data.text.queryOptions())
          );
          yield* Effect.promise(
            async () => await server.query(http.data.form.queryOptions())
          );
          yield* Effect.promise(
            async () => await server.query(http.data.bytes.queryOptions())
          );
          yield* Effect.promise(
            async () => await server.query(http.data.raw.queryOptions())
          );
          yield* Effect.promise(
            async () => await server.query(http.data.wrapped.queryOptions())
          );
          yield* Effect.promise(
            async () => await server.query(http.data.wrapped.metadataOptions())
          );
          yield* Effect.promise(
            async () =>
              await server.query(http.data.wrappedEmpty.queryOptions())
          );
          yield* Effect.promise(
            async () =>
              await server.query(http.data.encodedHeaders.queryOptions())
          );
          yield* Effect.promise(
            async () => await server.query(http.data.multi.queryOptions())
          );

          yield* roundTripJson(registry, server, browser);

          const jsonMeta = browser.getQueryData(http.data.json.metadataKey());
          const wrapped = browser.getQueryData(http.data.wrapped.queryKey());
          const wrappedMeta = browser.getQueryData(
            http.data.wrapped.metadataKey()
          );
          const wrappedEmpty = browser.getQueryData(
            http.data.wrappedEmpty.queryKey()
          );
          const encodedHeaders = browser.getQueryData(
            http.data.encodedHeaders.queryKey()
          );

          /* oxlint-disable typescript/no-unsafe-assignment */
          expect({
            uploadMatches: registry.matches(http.data.upload.mutationKey()),
            ping: browser.getQueryData(http.ping.queryKey()),
            json: browser.getQueryData(http.data.json.queryKey()),
            jsonMetaData: jsonMeta?.data,
            jsonMetaStatus: jsonMeta?.status,
            jsonMetaHeader: jsonMeta?.headers["x-source"],
            jsonMetaFrozen: Object.isFrozen(jsonMeta),
            jsonMetaHeadersFrozen: Object.isFrozen(jsonMeta?.headers),
            text: browser.getQueryData(http.data.text.queryKey()),
            form: browser.getQueryData(http.data.form.queryKey()),
            bytes: browser.getQueryData(http.data.bytes.queryKey()),
            raw: browser.getQueryData(http.data.raw.queryKey()),
            wrappedIsBrand: Predicate.hasProperty(
              wrapped,
              HttpApiSchema.WithHeadersValueTypeId
            ),
            wrappedBody: wrapped?.body,
            wrappedVersion: wrapped?.headers["x-version"],
            wrappedMetaBody: wrappedMeta?.data.body,
            wrappedMetaEtag: wrappedMeta?.headers["etag"],
            wrappedMetaFrozen: Object.isFrozen(wrappedMeta),
            wrappedEmptyBrand: Predicate.hasProperty(
              wrappedEmpty,
              HttpApiSchema.WithHeadersValueTypeId
            ),
            wrappedEmptyBody: wrappedEmpty?.body,
            wrappedEmptyEtag: wrappedEmpty?.headers["x-etag"],
            encodedHeaders,
            encodedCredits: encodedHeaders?.credits,
            multi: browser.getQueryData(http.data.multi.queryKey()),
          }).toStrictEqual({
            uploadMatches: false,
            ping: null,
            json: expect.any(Profile),
            jsonMetaData: expect.any(Profile),
            jsonMetaStatus: 200,
            jsonMetaHeader: "server",
            jsonMetaFrozen: true,
            jsonMetaHeadersFrozen: true,
            text: "plain text",
            form: { page: 4, tag: "ok" },
            bytes: new Uint8Array([1, 2, 3, 255]),
            raw: expect.any(Profile),
            wrappedIsBrand: true,
            wrappedBody: expect.any(Profile),
            wrappedVersion: 9,
            wrappedMetaBody: expect.any(Profile),
            wrappedMetaEtag: "v9",
            wrappedMetaFrozen: true,
            wrappedEmptyBrand: true,
            wrappedEmptyBody: undefined,
            wrappedEmptyEtag: "empty-tag",
            encodedHeaders: expect.any(Profile),
            encodedCredits: 23n,
            multi: expect.any(Profile),
          });
          /* oxlint-enable typescript/no-unsafe-assignment */
        } finally {
          server.clear();
          browser.clear();
        }
      })
  );

  it.effect(
    "round-trips HTTP SSE (data, events, WithHeaders) and NDJSON live and streamed views",
    () =>
      Effect.gen(function* roundTripsHttpStreams() {
        const CustomEvent = Schema.Struct({
          ...Sse.EventEncoded.fields,
          event: Schema.Literal("tick"),
          data: Schema.fromJsonString(Schema.toCodecJson(Profile)),
        });
        const api = HttpApi.make("hydration-streams").add(
          HttpApiGroup.make("streams").add(
            HttpApiEndpoint.get("sseData", "/sse-data", {
              success: HttpApiSchema.StreamSse({
                data: Schema.Union([
                  Profile,
                  Schema.Undefined,
                  Schema.Null,
                  DiagnosticEvent,
                ]),
              }),
            }),
            HttpApiEndpoint.get("sseEvents", "/sse-events", {
              success: HttpApiSchema.StreamSse({
                events: CustomEvent,
              }),
            }),
            HttpApiEndpoint.get("ndjson", "/ndjson", {
              success: HttpApiSchema.StreamNdjson({
                schema: Schema.UndefinedOr(Schema.NullOr(Profile)),
              }),
            }),
            HttpApiEndpoint.get("ndjsonHeaders", "/ndjson-headers", {
              success: HttpApiSchema.WithHeaders(
                HttpApiSchema.StreamNdjson({ schema: Profile }),
                { "x-stream-id": Schema.String }
              ),
            })
          )
        );

        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: dummyHttpClient,
        });
        const http = createHttpApiQueryUtils(api, { client });
        const registry = createContractHydrationRegistry(api, {
          views: { metadata: { headers: ["x-source", "etag"] } },
        });
        const server = new QueryClient();
        const browser = new QueryClient();
        try {
          const sseDataStreamKey = http.streams.sseData.streamedKey({
            maxChunks: "unbounded",
          });
          const sseDataLiveKey = http.streams.sseData.liveKey();
          const sseEventsStreamKey = http.streams.sseEvents.streamedKey({
            maxChunks: "unbounded",
          });
          const ndjsonStreamKey = http.streams.ndjson.streamedKey({
            maxChunks: "unbounded",
          });
          const ndjsonLiveKey = http.streams.ndjson.liveKey();
          const ndjsonHeadersKey = http.streams.ndjsonHeaders.liveKey();

          server.setQueryData(sseDataStreamKey, [
            profile,
            diagnosticEvent,
            undefined,
            null,
          ]);
          server.setQueryData(sseDataLiveKey, null);
          server.setQueryData(sseEventsStreamKey, [
            { event: "tick", data: profile },
          ]);
          server.setQueryData(ndjsonStreamKey, [profile, undefined, null]);
          server.setQueryData(ndjsonLiveKey, null);
          server.setQueryData(
            ndjsonHeadersKey,
            HttpApiSchema.withHeaders({
              body: profile,
              headers: { "x-stream-id": "s-1" },
            })
          );

          yield* roundTripJson(registry, server, browser);

          const restoredWrapped = browser.getQueryData(ndjsonHeadersKey);
          /* oxlint-disable typescript/no-unsafe-assignment */
          expect({
            sseDataStream: browser.getQueryData(sseDataStreamKey),
            sseDataLive: browser.getQueryData(sseDataLiveKey),
            sseEventsStream: browser.getQueryData(sseEventsStreamKey),
            ndjsonStream: browser.getQueryData(ndjsonStreamKey),
            ndjsonLive: browser.getQueryData(ndjsonLiveKey),
            wrappedBrand: Predicate.hasProperty(
              restoredWrapped,
              HttpApiSchema.WithHeadersValueTypeId
            ),
            wrappedBody: restoredWrapped?.body,
            wrappedHeader: restoredWrapped?.headers["x-stream-id"],
          }).toStrictEqual({
            sseDataStream: [
              expect.any(Profile),
              diagnosticEvent,
              undefined,
              null,
            ],
            sseDataLive: null,
            sseEventsStream: [{ event: "tick", data: expect.any(Profile) }],
            ndjsonStream: [expect.any(Profile), undefined, null],
            ndjsonLive: null,
            wrappedBrand: true,
            wrappedBody: expect.any(Profile),
            wrappedHeader: "s-1",
          });
          /* oxlint-enable typescript/no-unsafe-assignment */
        } finally {
          server.clear();
          browser.clear();
        }
      })
  );

  it.effect(
    "inherits custom HTTP query codec into metadata.data and infinite.page unless overridden or disabled",
    () =>
      Effect.gen(function* inheritsHttpQueryOverride() {
        const Tagged = Schema.String.pipe(
          Schema.decodeTo(
            Schema.String,
            SchemaTransformation.transform({
              decode: (value) => value.replace(/^override:/u, ""),
              encode: (value) => `override:${value}`,
            })
          )
        );
        const api = HttpApi.make("inherit-http").add(
          HttpApiGroup.make("items").add(
            HttpApiEndpoint.get("get", "/items", { success: Schema.String })
          )
        );
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: dummyHttpClient,
        });
        const http = createHttpApiQueryUtils(api, { client });
        const registry = createContractHydrationRegistry(api, {
          paths: {
            "items.get": {
              query: Tagged,
              metadata: { headers: ["etag"] },
              infinite: { pageParam: Schema.Int },
            },
          },
        });
        const server = new QueryClient();
        const browser = new QueryClient();
        try {
          const metaKey = http.items.get.metadataKey();
          const infKey = http.items.get.infiniteKey();
          server.setQueryData(metaKey, {
            data: "hello",
            status: 200,
            headers: { etag: "1" },
          });
          server.setQueryData(infKey, {
            pages: ["hello"],
            pageParams: [1],
          });
          const snapshot = dehydrate(server);
          const encoded = yield* registry.encodeQueries(snapshot.queries);
          const encodedMeta = encoded.find(
            (q) => JSON.stringify(q.queryKey) === JSON.stringify(metaKey)
          );
          const encodedInf = encoded.find(
            (q) => JSON.stringify(q.queryKey) === JSON.stringify(infKey)
          );
          const decoded = yield* registry.decodeQueries(encoded);
          hydrate(browser, { ...snapshot, queries: decoded });
          const restoredMeta = browser.getQueryData(metaKey);
          expect({
            encodedMeta: encodedMeta?.state.data,
            encodedInf: encodedInf?.state.data,
            restoredMeta,
            metaFrozen: Object.isFrozen(restoredMeta),
            headersFrozen: Object.isFrozen(restoredMeta?.headers),
            restoredInf: browser.getQueryData(infKey),
          }).toStrictEqual({
            encodedMeta: {
              data: "override:hello",
              status: 200,
              headers: { etag: "1" },
            },
            encodedInf: {
              pages: ["override:hello"],
              pageParams: [1],
            },
            restoredMeta: {
              data: "hello",
              status: 200,
              headers: { etag: "1" },
            },
            metaFrozen: true,
            headersFrozen: true,
            restoredInf: {
              pages: ["hello"],
              pageParams: [1],
            },
          });
        } finally {
          server.clear();
          browser.clear();
        }
      })
  );
});

const opaqueBrand = Symbol("OpaqueBox");
interface OpaqueBox {
  readonly [opaqueBrand]: true;
  readonly secret: string;
}
const makeOpaqueBox = (secret: string): OpaqueBox => ({
  [opaqueBrand]: true,
  secret,
});
const isOpaqueBox = (value: unknown): value is OpaqueBox =>
  Predicate.isObject(value) && value[opaqueBrand] === true;

describe("eager validation & HydrationCodecError", () => {
  it.effect("derives explicitly JSON-backed opaque and unknown schemas", () =>
    Effect.gen(function* roundTripsExplicitJsonCodecs() {
      const decodeString = SchemaParser.decodeUnknownEffect(Schema.String);
      const opaque = Schema.Json.pipe(
        Schema.decodeTo(
          Schema.declare(isOpaqueBox),
          SchemaTransformation.transformEffect({
            decode: (json) => Effect.map(decodeString(json), makeOpaqueBox),
            encode: (box) => Effect.succeed(box.secret),
          })
        )
      );
      const success = Schema.Struct({
        box: Schema.optionalKey(opaque),
        value: Schema.Json.pipe(Schema.decodeTo(Schema.Unknown)),
        object: Schema.JsonObject.pipe(Schema.decodeTo(Schema.ObjectKeyword)),
      });
      const group = RpcGroup.make(Rpc.make("read", { success }));
      const registry = createContractHydrationRegistry(group);
      const key = ["rpc", "read", "query"];
      const server = new QueryClient();
      const browser = new QueryClient();
      const value = {
        box: makeOpaqueBox("42"),
        value: [null, 42],
        object: { ready: true },
      };
      server.setQueryData(key, value);
      yield* roundTripJson(registry, server, browser);
      expect(browser.getQueryData(key)).toStrictEqual(value);
    })
  );

  it.each([Schema.Unknown, Schema.ObjectKeyword])(
    "rejects an optional property with an implicit JSON fallback",
    (fallback) => {
      const group = RpcGroup.make(
        Rpc.make("read", {
          success: Schema.Struct({ value: Schema.optionalKey(fallback) }),
        })
      );
      expect(() => createContractHydrationRegistry(group)).toThrow(
        expect.objectContaining({ code: "UnencodableSchema", path: "read" })
      );
    }
  );

  it.effect("derives an explicit JSON codec with a union on the wire", () =>
    Effect.gen(function* roundTripsExplicitUnionCodec() {
      const wire = Schema.Union([Schema.String, Schema.Finite]);
      const decodeValue = SchemaParser.decodeUnknownEffect(
        Schema.Struct({ value: wire })
      );
      const success = wire.pipe(
        Schema.decodeTo(
          Schema.Unknown,
          SchemaTransformation.transformEffect<unknown, string | number>({
            decode: (value) => Effect.succeed({ value }),
            encode: (value) =>
              Effect.map(decodeValue(value), (decoded) => decoded.value),
          })
        )
      );
      const group = RpcGroup.make(Rpc.make("read", { success }));
      const registry = createContractHydrationRegistry(group);
      const key = ["rpc", "read", "query"];
      const server = new QueryClient();
      const browser = new QueryClient();
      server.setQueryData(key, { value: 4 });
      yield* roundTripJson(registry, server, browser);
      expect(browser.getQueryData(key)).toStrictEqual({ value: 4 });
    })
  );

  it("rejects opaque Schema.declare, Redacted, and unencodable encodeToWithHeaders unless overridden or opted out", () => {
    const OpaqueSchema = Schema.declare(isOpaqueBox);
    const OpaqueCodec = Schema.String.pipe(
      Schema.decodeTo(
        OpaqueSchema,
        SchemaTransformation.transform({
          decode: makeOpaqueBox,
          encode: (box) => box.secret,
        })
      )
    );

    const opaqueGroup = RpcGroup.make(
      Rpc.make("opaque.get", { success: OpaqueSchema })
    );
    const opaqueErr = captureHydrationError(() => {
      createContractHydrationRegistry(opaqueGroup);
    });

    const redactedGroup = RpcGroup.make(
      Rpc.make("secrets.get", {
        success: Schema.Struct({ token: Schema.Redacted(Schema.String) }),
      })
    );
    const redactedErr = captureHydrationError(() => {
      createContractHydrationRegistry(redactedGroup);
    });

    const unencodableHeadersSchema = OpaqueSchema.pipe(
      HttpApiSchema.encodeToWithHeaders(
        {
          body: Schema.String,
          headers: { "x-secret": Schema.String },
        },
        {
          decode: ({ body }) => makeOpaqueBox(body),
          encode: (box) => ({ body: box.secret, headers: { "x-secret": "1" } }),
        }
      )
    );
    const badHttpApi = HttpApi.make("bad-http").add(
      HttpApiGroup.make("boxes").add(
        HttpApiEndpoint.get("get", "/box", {
          success: unencodableHeadersSchema,
        })
      )
    );
    const headersErr = captureHydrationError(() => {
      createContractHydrationRegistry(badHttpApi);
    });

    expect({
      opaque: {
        code: opaqueErr.code,
        path: opaqueErr.path,
        view: opaqueErr.view,
      },
      redacted: {
        code: redactedErr.code,
        path: redactedErr.path,
        view: redactedErr.view,
      },
      headers: {
        code: headersErr.code,
        path: headersErr.path,
        view: headersErr.view,
      },
      opaqueOptOut: createContractHydrationRegistry(opaqueGroup, {
        paths: { "opaque.get": false },
      }).matches(["rpc", "opaque", "get", "query"]),
      opaqueOverride: createContractHydrationRegistry(opaqueGroup, {
        paths: { "opaque.get": { query: OpaqueCodec } },
      }).matches(["rpc", "opaque", "get", "query"]),
      redactedOptOut: createContractHydrationRegistry(redactedGroup, {
        paths: { "secrets.get": { query: false } },
      }).matches(["rpc", "secrets", "get", "query"]),
      headersOverride: createContractHydrationRegistry(badHttpApi, {
        paths: {
          "boxes.get": {
            query: OpaqueCodec,
            metadata: { headers: ["etag"] },
          },
        },
      }).matches(["http", "bad-http", "boxes", "get", "metadata"]),
    }).toStrictEqual({
      opaque: { code: "UnencodableSchema", path: "opaque.get", view: "query" },
      redacted: {
        code: "UnencodableSchema",
        path: "secrets.get",
        view: "query",
      },
      headers: { code: "UnencodableSchema", path: "boxes.get", view: "query" },
      opaqueOptOut: false,
      opaqueOverride: true,
      redactedOptOut: false,
      headersOverride: true,
    });
  });

  it("rejects unknown paths, ambiguous dotted HTTP paths, and invalid keyPrefix eagerly", () => {
    const group = RpcGroup.make(
      Rpc.make("users.get", { success: Schema.String })
    );

    const emptyPrefixErr = captureHydrationError(() => {
      // @ts-expect-error runtime empty keyPrefix check
      createContractHydrationRegistry(group, { keyPrefix: [] });
    });
    const nonJsonPrefixErr = captureHydrationError(() => {
      // @ts-expect-error runtime non-JSON keyPrefix check
      createContractHydrationRegistry(group, { keyPrefix: [new Date(0)] });
    });
    const unknownPathErr = captureHydrationError(() => {
      // @ts-expect-error runtime unknown path check
      createContractHydrationRegistry(group, {
        paths: { "users.missing": false },
      });
    });

    const ambiguousApi = HttpApi.make("ambiguous")
      .add(
        HttpApiGroup.make("a").add(
          HttpApiEndpoint.get("b.c", "/1", { success: Schema.String })
        )
      )
      .add(
        HttpApiGroup.make("a.b").add(
          HttpApiEndpoint.get("c", "/2", { success: Schema.String })
        )
      );

    const ambiguousErr = captureHydrationError(() => {
      createContractHydrationRegistry(ambiguousApi, {
        paths: { "a.b.c": false },
      });
    });
    const hiddenPaths = { "a.b.c": false } as const;
    Object.defineProperty(hiddenPaths, "a.b.c", { enumerable: false });
    const hiddenAmbiguousErr = captureHydrationError(() => {
      createContractHydrationRegistry(ambiguousApi, { paths: hiddenPaths });
    });

    const expected = {
      emptyPrefix: { code: "InvalidKeyPrefix" },
      nonJsonPrefix: { code: "InvalidKeyPrefix" },
      unknownPath: { code: "UnknownPath", path: "users.missing" },
      ambiguous: { code: "InvalidContractPath", path: "a.b.c" },
      hiddenAmbiguous: { code: "InvalidContractPath", path: "a.b.c" },
    } as const;

    expect({
      emptyPrefix: { code: emptyPrefixErr.code },
      nonJsonPrefix: { code: nonJsonPrefixErr.code },
      unknownPath: { code: unknownPathErr.code, path: unknownPathErr.path },
      ambiguous: { code: ambiguousErr.code, path: ambiguousErr.path },
      hiddenAmbiguous: {
        code: hiddenAmbiguousErr.code,
        path: hiddenAmbiguousErr.path,
      },
      bareAmbiguousOk: createContractHydrationRegistry(ambiguousApi).matches([
        "http",
        "ambiguous",
        "a",
        "b.c",
        "query",
      ]),
    }).toStrictEqual({
      ...expected,
      bareAmbiguousOk: true,
    });
  });
});

const EncodeSvc = Context.Service<{ readonly offset: bigint }>(
  "UnionEncodeSvc"
);

it.effect(
  "round-trips an encoded-side union with separate Effect services",
  () =>
    Effect.gen(function* roundTripsTransformedUnion() {
      const Value = Schema.Union([Schema.BigInt, Schema.String]);
      const Transformed = Value.pipe(
        Schema.decodeTo(
          Schema.Struct({ value: Value }),
          SchemaTransformation.transformEffect({
            decode: (value) =>
              DecodeSvc.pipe(
                Effect.map(({ tag }) => ({
                  value: Predicate.isString(value)
                    ? value.slice(tag.length)
                    : value - 1n,
                }))
              ),
            encode: ({ value }) =>
              EncodeSvc.pipe(
                Effect.map(({ offset }) =>
                  Predicate.isString(value)
                    ? `${offset}${value}`
                    : value + offset
                )
              ),
          })
        )
      );
      const group = RpcGroup.make(Rpc.make("read", { success: Transformed }));
      const registry = createContractHydrationRegistry(group);
      const key = ["rpc", "read", "query"];
      const server = new QueryClient();
      server.setQueryData(key, { value: "42" });
      const snapshot = dehydrate(server);
      const encoded = yield* registry
        .encodeQueries(snapshot.queries)
        .pipe(Effect.provideService(EncodeSvc, { offset: 1n }));
      const json = JSON.stringify({ ...snapshot, queries: encoded });
      const strictJson = yield* Schema.decodeEffect(
        Schema.fromJsonString(Schema.Json)
      )(json);
      const wire = parseSnapshot(json);
      expect(wire).toStrictEqual(strictJson);
      const decoded = yield* registry
        .decodeQueries(wire.queries)
        .pipe(Effect.provideService(DecodeSvc, { tag: "1" }));
      const browser = new QueryClient();
      hydrate(browser, { ...snapshot, queries: decoded });
      expect(browser.getQueryData(key)).toStrictEqual({ value: "42" });
    })
);

describe("composable createHydrationRegistry", () => {
  it.effect(
    "flattens package registries alongside manual codecs, detects duplicate codecs, and rejects structural fakes",
    () =>
      Effect.gen(function* composesRegistries() {
        const ServiceString = Schema.String.pipe(
          Schema.middlewareDecoding((decode) =>
            DecodeSvc.pipe(Effect.andThen(decode))
          )
        );

        const rpcGroup = RpcGroup.make(
          Rpc.make("users.read", { success: Profile })
        );
        const httpApi = HttpApi.make("compose-http").add(
          HttpApiGroup.make("items").add(
            HttpApiEndpoint.get("get", "/items", { success: ServiceString })
          )
        );
        const extraGroup = RpcGroup.make(
          Rpc.make("extra.read", { success: Schema.String })
        );

        const rpcClient = yield* makeRpcTestClient(rpcGroup, {
          "users.read": () => Effect.succeed(profile),
        });
        const extraClient = yield* makeRpcTestClient(extraGroup, {
          "extra.read": () => Effect.succeed("extra-val"),
        });
        const httpClient = yield* HttpApiClient.makeWith(httpApi, {
          baseUrl: "https://example.test",
          httpClient: dummyHttpClient,
        });

        const runtime = ManagedRuntime.make(
          Layer.succeed(DecodeSvc, { tag: "ok" })
        );
        const rpcUtils = createRpcQueryUtils(rpcGroup, { client: rpcClient });
        const httpUtils = createHttpApiQueryUtils(httpApi, {
          client: httpClient,
          runtime,
        });
        const extraUtils = createRpcQueryUtils(extraGroup, {
          client: extraClient,
          keyPrefix: ["extra"],
        });

        const rpcReg = createContractHydrationRegistry(rpcGroup);
        const httpReg = createContractHydrationRegistry(httpApi);
        const customCodec = queryViewCodec(
          extraUtils.extra.read,
          "query",
          Schema.String
        );

        const combined = createHydrationRegistry([
          rpcReg,
          httpReg,
          customCodec,
        ]);

        const server = new QueryClient();
        const browser = new QueryClient();
        try {
          server.setQueryData(rpcUtils.users.read.queryKey(), profile);
          server.setQueryData(httpUtils.items.get.queryKey(), "svc-item");
          server.setQueryData(extraUtils.extra.read.queryKey(), "extra-val");

          const snapshot = dehydrate(server);
          const encoded = yield* combined.encodeQueries(snapshot.queries);
          const decoded = yield* combined
            .decodeQueries(encoded)
            .pipe(Effect.provideService(DecodeSvc, { tag: "ok" }));
          hydrate(browser, { ...snapshot, queries: decoded });

          const duplicateManual = queryViewCodec(
            rpcUtils.users.read,
            "query",
            Profile
          );
          const fakeStructuralRegistry = {
            matches: () => true,
            encodeQueries: (q: Parameters<typeof rpcReg.encodeQueries>[0]) =>
              Effect.succeed(q),
            decodeQueries: (q: Parameters<typeof rpcReg.decodeQueries>[0]) =>
              Effect.succeed(q),
          };

          /* oxlint-disable typescript/no-unsafe-assignment */
          expect({
            rpcMatch: combined.matches(rpcUtils.users.read.queryKey()),
            httpMatch: combined.matches(httpUtils.items.get.queryKey()),
            extraMatch: combined.matches(extraUtils.extra.read.queryKey()),
            rpcRestored: browser.getQueryData(rpcUtils.users.read.queryKey()),
            httpRestored: browser.getQueryData(httpUtils.items.get.queryKey()),
            extraRestored: browser.getQueryData(
              extraUtils.extra.read.queryKey()
            ),
            dupRegCode: captureHydrationError(() => {
              createHydrationRegistry([rpcReg, rpcReg]);
            }).code,
            dupManualCode: captureHydrationError(() => {
              createHydrationRegistry([rpcReg, duplicateManual]);
            }).code,
            fakeRejected:
              captureHydrationError(() => {
                createHydrationRegistry([fakeStructuralRegistry]);
              }) instanceof HydrationCodecError,
          }).toStrictEqual({
            rpcMatch: true,
            httpMatch: true,
            extraMatch: true,
            rpcRestored: expect.any(Profile),
            httpRestored: "svc-item",
            extraRestored: "extra-val",
            dupRegCode: "DuplicateCodec",
            dupManualCode: "DuplicateCodec",
            fakeRejected: true,
          });
          /* oxlint-enable typescript/no-unsafe-assignment */
        } finally {
          server.clear();
          browser.clear();
          yield* Effect.promise(async () => {
            await runtime.dispose();
          });
        }
      })
  );

  it("rejects nested Redacted schemas inside Option, unions, structs, declarations, and suspended schemas", () => {
    const redactedValue = Schema.RedactedFromValue(Schema.String);
    const suspendedNested = Schema.suspend(() =>
      Schema.Struct({ token: Schema.Option(redactedValue) })
    );
    const rpcCases = [
      RpcGroup.make(
        Rpc.make("opt.get", { success: Schema.Option(redactedValue) })
      ),
      RpcGroup.make(
        Rpc.make("union.get", {
          success: Schema.Union([Schema.String, redactedValue]),
        })
      ),
      RpcGroup.make(
        Rpc.make("struct.get", {
          success: Schema.Struct({
            nested: Schema.Option(redactedValue),
          }),
        })
      ),
      RpcGroup.make(
        Rpc.make("array.get", {
          success: Schema.Array(redactedValue),
        })
      ),
      RpcGroup.make(
        Rpc.make("suspend.get", {
          success: suspendedNested,
        })
      ),
    ];
    const httpOptionApi = HttpApi.make("nested-redacted-http").add(
      HttpApiGroup.make("secrets").add(
        HttpApiEndpoint.get("get", "/secret", {
          success: Schema.Option(redactedValue),
        })
      )
    );

    const results = [
      ...rpcCases.map(
        (group) =>
          captureHydrationError(() => {
            createContractHydrationRegistry(group);
          }).code
      ),
      captureHydrationError(() => {
        createContractHydrationRegistry(httpOptionApi);
      }).code,
    ];
    const optedOut = createContractHydrationRegistry(httpOptionApi, {
      paths: { "secrets.get": false },
    }).matches(["http", "nested-redacted-http", "secrets", "get", "query"]);
    expect({ results, optedOut }).toStrictEqual({
      results: [
        "UnencodableSchema",
        "UnencodableSchema",
        "UnencodableSchema",
        "UnencodableSchema",
        "UnencodableSchema",
        "UnencodableSchema",
      ],
      optedOut: false,
    });
  });

  it.effect(
    "preserves cached HttpApiSchema.asNoContent values across query, metadata, and infinite views without re-invoking the factory",
    () =>
      Effect.gen(function* preservesAsNoContentValues() {
        let stampCalls = 0;
        let profileCalls = 0;
        const Synthesized = Schema.Struct({ stamp: Schema.Finite }).pipe(
          HttpApiSchema.asNoContent({
            decode: () => {
              stampCalls += 1;
              return { stamp: stampCalls };
            },
          }),
          HttpApiSchema.status(204)
        );
        const SynthesizedProfile = Profile.pipe(
          HttpApiSchema.asNoContent({
            decode: () => {
              profileCalls += 1;
              return new Profile({
                name: `cached-${profileCalls}`,
                credits: BigInt(profileCalls),
                avatar: new Uint8Array([profileCalls]),
              });
            },
          }),
          HttpApiSchema.status(204)
        );
        const api = HttpApi.make("no-content-hydration").add(
          HttpApiGroup.make("items").add(
            HttpApiEndpoint.get("synthesized", "/synthesized", {
              success: Synthesized,
            }),
            HttpApiEndpoint.get("profile", "/profile", {
              success: SynthesizedProfile,
            }),
            HttpApiEndpoint.get("empty", "/empty", {
              success: HttpApiSchema.NoContent,
            })
          )
        );
        const httpClient = HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(null, { status: 204 })
            )
          )
        );
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient,
        });
        const http = createHttpApiQueryUtils(api, { client });
        const registry = createContractHydrationRegistry(api, {
          views: { metadata: { headers: [] } },
          paths: {
            "items.synthesized": {
              infinite: { pageParam: Schema.Int },
            },
            "items.empty": {
              infinite: { pageParam: Schema.Int },
            },
          },
        });
        const server = new QueryClient();
        const browser = new QueryClient();
        try {
          const queryResult = yield* Effect.promise(
            async () =>
              await server.query(http.items.synthesized.queryOptions())
          );
          const profileResult = yield* Effect.promise(
            async () => await server.query(http.items.profile.queryOptions())
          );
          const emptyResult = yield* Effect.promise(
            async () => await server.query(http.items.empty.queryOptions())
          );
          server.setQueryData(http.items.synthesized.metadataKey(), {
            data: queryResult,
            status: 204,
            headers: {},
          });
          server.setQueryData(http.items.synthesized.infiniteKey(), {
            pages: [queryResult],
            pageParams: [1],
          });
          server.setQueryData(http.items.empty.metadataKey(), {
            data: null,
            status: 204,
            headers: {},
          });
          server.setQueryData(http.items.empty.infiniteKey(), {
            pages: [null],
            pageParams: [1],
          });

          const callsBeforeHydration = { stampCalls, profileCalls };
          yield* roundTripJson(registry, server, browser);

          const hydratedProfile = browser.getQueryData(
            http.items.profile.queryKey()
          );
          expect({
            emptyResult,
            callsBeforeHydration,
            callsAfterHydration: { stampCalls, profileCalls },
            hydratedQuery: browser.getQueryData(
              http.items.synthesized.queryKey()
            ),
            hydratedMeta: browser.getQueryData(
              http.items.synthesized.metadataKey()
            )?.data,
            hydratedInfinite: browser.getQueryData(
              http.items.synthesized.infiniteKey()
            ),
            hydratedProfileInstance: hydratedProfile instanceof Profile,
            hydratedProfileName: hydratedProfile?.name,
            hydratedEmpty: browser.getQueryData(http.items.empty.queryKey()),
            hydratedEmptyMeta: browser.getQueryData(
              http.items.empty.metadataKey()
            )?.data,
            hydratedEmptyInfinite: browser.getQueryData(
              http.items.empty.infiniteKey()
            ),
          }).toStrictEqual({
            emptyResult: null,
            callsBeforeHydration: { stampCalls: 1, profileCalls: 1 },
            callsAfterHydration: { stampCalls: 1, profileCalls: 1 },
            hydratedQuery: { stamp: 1 },
            hydratedMeta: { stamp: 1 },
            hydratedInfinite: { pages: [{ stamp: 1 }], pageParams: [1] },
            hydratedProfileInstance: true,
            hydratedProfileName: profileResult.name,
            hydratedEmpty: null,
            hydratedEmptyMeta: null,
            hydratedEmptyInfinite: { pages: [null], pageParams: [1] },
          });
        } finally {
          server.clear();
          browser.clear();
        }
      })
  );

  it.effect(
    "omits HTTP metadata by default and filters raw headers to the explicit allowlist",
    () =>
      Effect.gen(function* enforcesMetadataHeaderAllowlist() {
        const api = HttpApi.make("meta-headers").add(
          HttpApiGroup.make("docs").add(
            HttpApiEndpoint.get("read", "/doc", { success: Schema.String }),
            HttpApiEndpoint.get("other", "/other", { success: Schema.String })
          )
        );
        const httpClient = HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json("doc-body", {
                headers: {
                  etag: '"v1"',
                  "x-public": "visible",
                  "set-cookie": "session=secret-cookie",
                  "x-internal-token": "server-only-secret",
                },
              })
            )
          )
        );
        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient,
        });
        const http = createHttpApiQueryUtils(api, { client });
        const defaultRegistry = createContractHydrationRegistry(api);
        const allowlistedRegistry = createContractHydrationRegistry(api, {
          views: { metadata: { headers: ["ETag", "x-public"] } },
          paths: { "docs.other": { metadata: false } },
        });
        const server = new QueryClient();
        const browser = new QueryClient();
        try {
          yield* Effect.promise(
            async () => await server.query(http.docs.read.metadataOptions())
          );
          const snapshot = dehydrate(server);
          const unknownErr = yield* Effect.flip(
            defaultRegistry.encodeQueries(snapshot.queries)
          );
          const encoded = yield* allowlistedRegistry.encodeQueries(
            snapshot.queries
          );
          const encodedJson = JSON.stringify(encoded);
          const decoded = yield* allowlistedRegistry.decodeQueries(encoded);
          hydrate(browser, { ...snapshot, queries: decoded });
          const hydrated = browser.getQueryData(http.docs.read.metadataKey());

          const invalidMetadataErr = captureHydrationError(() => {
            // @ts-expect-error runtime rejection for boolean true metadata view
            createContractHydrationRegistry(api, { views: { metadata: true } });
          });

          expect({
            defaultMatches: defaultRegistry.matches(
              http.docs.read.metadataKey()
            ),
            otherDisabledMatches: allowlistedRegistry.matches(
              http.docs.other.metadataKey()
            ),
            unknownCode:
              unknownErr instanceof HydrationCodecError
                ? unknownErr.code
                : undefined,
            invalidCode: invalidMetadataErr.code,
            leakedCookie: encodedJson.includes("secret-cookie"),
            leakedInternal: encodedJson.includes("server-only-secret"),
            hydrated,
            frozen: Object.isFrozen(hydrated?.headers),
          }).toStrictEqual({
            defaultMatches: false,
            otherDisabledMatches: false,
            unknownCode: "UnknownQuery",
            invalidCode: "InvalidContractPath",
            leakedCookie: false,
            leakedInternal: false,
            hydrated: {
              data: "doc-body",
              status: 200,
              headers: { etag: '"v1"', "x-public": "visible" },
            },
            frozen: true,
          });
        } finally {
          server.clear();
          browser.clear();
        }
      })
  );

  it.effect(
    "handles union asNoContent, wrapped Void asNoContent, intermediate Void transforms, own metadata views, and encodeToWithHeaders Redacted checks",
    () =>
      Effect.gen(function* verifiesReviewEdgeCases() {
        let unionFactoryCalls = 0;
        let voidFactoryCalls = 0;
        const SynthesizedUnion = Schema.Union([
          Schema.String.pipe(
            HttpApiSchema.asNoContent({
              decode: () => {
                unionFactoryCalls += 1;
                return "factory";
              },
            })
          ),
          Schema.Finite,
        ]);
        const WrappedVoid = HttpApiSchema.WithHeaders(
          Schema.Void.pipe(
            HttpApiSchema.asNoContent({
              decode: () => {
                voidFactoryCalls += 1;
              },
            })
          ),
          { "x-id": Schema.String }
        );
        const ThroughVoid = Schema.String.pipe(
          Schema.decodeTo(
            Schema.Void,
            SchemaTransformation.transform({
              decode: Function.constVoid,
              encode: () => "wire-string",
            })
          ),
          Schema.decodeTo(
            Schema.declare(isOpaqueBox),
            SchemaTransformation.transform({
              decode: () => makeOpaqueBox("decoded"),
              encode: Function.constVoid,
            })
          )
        );
        const api = HttpApi.make("edge-cases").add(
          HttpApiGroup.make("items").add(
            HttpApiEndpoint.get("union", "/union", {
              success: SynthesizedUnion,
            }),
            HttpApiEndpoint.get("wrappedVoid", "/wrapped-void", {
              success: WrappedVoid,
            }),
            HttpApiEndpoint.get("throughVoid", "/through-void", {
              success: ThroughVoid,
            })
          )
        );
        const redactedEncodedHeadersApi = HttpApi.make("encoded-redacted").add(
          HttpApiGroup.make("items").add(
            HttpApiEndpoint.get("read", "/read", {
              success: Schema.String.pipe(
                HttpApiSchema.encodeToWithHeaders(
                  {
                    body: Schema.String,
                    headers: {
                      "x-secret": Schema.RedactedFromValue(Schema.String),
                    },
                  },
                  {
                    decode: ({ body }) => body,
                    encode: (body) => ({
                      body,
                      headers: { "x-secret": Redacted.make("secret") },
                    }),
                  }
                )
              ),
            })
          )
        );

        const client = yield* HttpApiClient.makeWith(api, {
          baseUrl: "https://example.test",
          httpClient: dummyHttpClient,
        });
        const http = createHttpApiQueryUtils(api, { client });
        const registry = createContractHydrationRegistry(api);
        const server = new QueryClient();
        const browser = new QueryClient();
        try {
          server.setQueryData(http.items.union.queryKey(), "cached");
          server.setQueryData(
            http.items.wrappedVoid.queryKey(),
            HttpApiSchema.withHeaders({
              body: undefined,
              headers: { "x-id": "1" },
            })
          );
          server.setQueryData(
            http.items.throughVoid.queryKey(),
            makeOpaqueBox("live")
          );
          yield* roundTripJson(registry, server, browser);

          const inheritedViews = {};
          Object.setPrototypeOf(inheritedViews, {
            metadata: { headers: ["etag"] },
          });
          const ownGetterViews = {
            get metadata() {
              return { headers: ["etag"] } as const;
            },
          };
          const ownNonEnumViews = {};
          Object.defineProperty(ownNonEnumViews, "metadata", {
            value: { headers: ["etag"] },
            enumerable: false,
          });

          const metaKey = http.items.union.metadataKey();
          expect({
            unionRestored: browser.getQueryData(http.items.union.queryKey()),
            unionFactoryCalls,
            wrappedVoidRestored: browser.getQueryData(
              http.items.wrappedVoid.queryKey()
            ),
            voidFactoryCalls,
            throughVoidRestored: browser.getQueryData(
              http.items.throughVoid.queryKey()
            )?.secret,
            inheritedMetaMatches: createContractHydrationRegistry(api, {
              views: inheritedViews,
            }).matches(metaKey),
            ownGetterMetaMatches: createContractHydrationRegistry(api, {
              views: ownGetterViews,
            }).matches(metaKey),
            ownNonEnumMetaMatches: createContractHydrationRegistry(api, {
              views: ownNonEnumViews,
            }).matches(metaKey),
            encodedHeadersRedactedCode: captureHydrationError(() => {
              createContractHydrationRegistry(redactedEncodedHeadersApi);
            }).code,
          }).toStrictEqual({
            unionRestored: "cached",
            unionFactoryCalls: 0,
            wrappedVoidRestored: HttpApiSchema.withHeaders({
              body: undefined,
              headers: { "x-id": "1" },
            }),
            voidFactoryCalls: 0,
            throughVoidRestored: "decoded",
            inheritedMetaMatches: false,
            ownGetterMetaMatches: true,
            ownNonEnumMetaMatches: true,
            encodedHeadersRedactedCode: "UnencodableSchema",
          });
        } finally {
          server.clear();
          browser.clear();
        }
      })
  );
});
