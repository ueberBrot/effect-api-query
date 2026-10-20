import { describe, it } from "@effect/vitest";
import { dehydrate, hydrate, QueryClient } from "@tanstack/query-core";
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  Schema,
  SchemaTransformation,
  Stream,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import { expect } from "vite-plus/test";

import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  HydrationCodecError,
} from "#effect-api-query";
import {
  createHydrationRegistry,
  hydrationCallbacks,
  infiniteQueryCodec,
  queryViewCodec,
} from "#effect-api-query/core/hydration";

import { makeRpcTestClient } from "./fixtures/effect-rpc.ts";
import { Profile } from "./types/docs-hydration-rich.ts";
import { Cursor, HistoryElement } from "./types/docs-hydration-views.ts";

const profile = new Profile({
  name: "Ada",
  credits: 23n,
  avatar: new Uint8Array([0, 128, 255]),
});
const group = RpcGroup.make(
  Rpc.make("read", { payload: { id: Schema.Int }, success: Profile }),
  Rpc.make("watch", {
    success: Schema.UndefinedOr(Schema.NullOr(Profile)),
    stream: true,
  })
);

describe.each(["short-first", "nested-first"] as const)(
  "hydration registration order %s",
  (order) => {
    it.effect(
      "selects the most specific registered view with nested application prefixes in %s order",
      () =>
        Effect.gen(function* selectsSpecificRegisteredView() {
          const client = yield* makeRpcTestClient(group, {
            read: () => Effect.succeed(profile),
            watch: () => Stream.empty,
          });
          const rpc = createRpcQueryUtils(group, {
            client,
            keyPrefix: ["nested"],
          });
          const nestedGroup = RpcGroup.make(
            Rpc.make("read", { success: Schema.String })
          );
          const nestedClient = yield* makeRpcTestClient(nestedGroup, {
            read: () => Effect.succeed("nested"),
          });
          const nested = createRpcQueryUtils(nestedGroup, {
            client: nestedClient,
            keyPrefix: [...rpc.read.key(), "query", "application"],
          });
          const shortCodec = queryViewCodec(rpc.read, "query", Profile);
          const nestedCodec = queryViewCodec(
            nested.read,
            "query",
            Schema.String
          );
          const registry = createHydrationRegistry(
            order === "short-first"
              ? [shortCodec, nestedCodec]
              : [nestedCodec, shortCodec]
          );
          const queryClient = new QueryClient();
          try {
            queryClient.setQueryData(nested.read.queryKey(), "nested");
            const queries = yield* registry.encodeQueries(
              dehydrate(queryClient).queries
            );
            expect(queries[0]?.state.data).toBe("nested");
          } finally {
            queryClient.clear();
          }
        })
    );
  }
);

it.effect(
  "round-trips rich query, infinite, accumulated, and live data through one registry",
  () =>
    Effect.gen(function* roundTripsRegisteredQueryViews() {
      const client = yield* makeRpcTestClient(group, {
        read: () => Effect.succeed(profile),
        watch: () => Stream.fromIterable([profile, undefined, null]),
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["registry"],
      });
      const registry = createHydrationRegistry([
        queryViewCodec(rpc.read, "query", Profile),
        infiniteQueryCodec(rpc.read, { page: Profile, pageParam: Cursor }),
        queryViewCodec(rpc.watch, "streamed", Schema.Array(HistoryElement)),
        queryViewCodec(rpc.watch, "live", Schema.NullOr(Profile)),
      ]);
      const server = new QueryClient();
      const browser = new QueryClient();
      try {
        const ordinary = rpc.read.queryOptions({
          input: { id: 1 },
          select: (data) => data.summary(),
          staleTime: Infinity,
        });
        const pages = rpc.read.infiniteOptions({
          initialPageParam: new Cursor({ offset: 0n }),
          input: (cursor) => ({ id: Number(cursor.offset) }),
          getNextPageParam: () => null,
          staleTime: Infinity,
        });
        yield* Effect.promise(async () => await server.query(ordinary));
        yield* Effect.promise(async () => await server.infiniteQuery(pages));
        yield* Effect.promise(
          async () => await server.query(rpc.watch.streamedOptions())
        );
        yield* Effect.promise(
          async () =>
            await server.query(rpc.watch.streamedOptions({ maxChunks: 2 }))
        );
        yield* Effect.promise(
          async () => await server.query(rpc.watch.liveOptions())
        );
        const snapshot = dehydrate(server, {
          shouldDehydrateMutation: () => false,
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" &&
            registry.matches(query.queryKey),
        });
        const queries = yield* registry.encodeQueries(snapshot.queries);
        const json = JSON.stringify({ ...snapshot, queries });
        // oxlint-disable-next-line typescript/no-unsafe-assignment
        const wire: typeof snapshot = JSON.parse(json);
        const prepared = yield* registry.decodeQueries(wire.queries);
        hydrate(browser, { ...wire, queries: prepared });
        const restored = browser.getQueryData(ordinary.queryKey);
        const restoredPages = browser.getQueryData(pages.queryKey);
        const history = browser.getQueryData(rpc.watch.streamedKey());
        /* oxlint-disable typescript/no-unsafe-assignment */
        expect({
          ordinary: restored,
          summary: restored?.summary(),
          avatar: restored?.avatar,
          page: restoredPages?.pages[0],
          cursor: restoredPages?.pageParams[0],
          atStart: restoredPages?.pageParams[0]?.isStart(),
          history,
          boundedHistory: browser.getQueryData(
            rpc.watch.streamedKey({ maxChunks: 2 })
          ),
          live: browser.getQueryData(rpc.watch.liveKey()),
          serverCursor: server.getQueryData(pages.queryKey)?.pageParams[0],
        }).toStrictEqual({
          ordinary: expect.any(Profile),
          summary: "Ada: 23 credits",
          avatar: new Uint8Array([0, 128, 255]),
          page: expect.any(Profile),
          cursor: expect.any(Cursor),
          atStart: true,
          history: [expect.any(Profile), undefined, null],
          boundedHistory: [undefined, null],
          live: null,
          serverCursor: expect.any(Cursor),
        });
        /* oxlint-enable typescript/no-unsafe-assignment */
        expect(server.getQueryData(ordinary.queryKey)).toBe(profile);
        expect(
          yield* Effect.promise(async () => await browser.query(ordinary))
        ).toBe(restored?.summary());
        yield* Effect.promise(async () => {
          await browser.invalidateQueries({
            queryKey: ordinary.queryKey,
            exact: true,
          });
        });
        yield* Effect.promise(async () => await browser.query(ordinary));
        expect(browser.getQueryData(ordinary.queryKey)).toBeInstanceOf(Profile);
      } finally {
        server.clear();
        browser.clear();
      }
    })
);

it.effect(
  "registers HTTP metadata with explicit decoded header-wrapper codecs",
  () =>
    Effect.gen(function* hydratesDecodedHeaderWrappers() {
      const headers = Schema.Struct({ "x-version": Schema.FiniteFromString });
      const success = HttpApiSchema.WithHeaders(Profile, headers);
      const wrapped = Schema.Struct({ body: Profile, headers }).pipe(
        Schema.decodeTo(
          Schema.toType(success),
          SchemaTransformation.transform({
            decode: HttpApiSchema.withHeaders,
            encode: ({ body, headers: decoded }) => ({
              body,
              headers: decoded,
            }),
          })
        )
      );
      const api = HttpApi.make("registry-http").add(
        HttpApiGroup.make("profiles").add(
          HttpApiEndpoint.get("read", "/profile", { success })
        )
      );
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: "https://example.test",
        httpClient: HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(Schema.encodeSync(Profile)(profile), {
                headers: { "x-version": "7", etag: "public" },
              })
            )
          )
        ),
      });
      const http = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["registry"],
      });
      const codec = queryViewCodec(
        http.profiles.read,
        "metadata",
        Schema.Struct({
          data: wrapped,
          status: Schema.Finite,
          headers: Schema.Record(Schema.String, Schema.String),
        })
      );
      const registry = createHydrationRegistry([codec]);
      const server = new QueryClient();
      const browser = new QueryClient();
      try {
        const options = http.profiles.read.metadataOptions();
        yield* Effect.promise(async () => await server.query(options));
        const snapshot = dehydrate(server, {
          shouldDehydrateMutation: () => false,
        });
        const queries = yield* registry.encodeQueries(snapshot.queries);
        const json = JSON.stringify({ ...snapshot, queries });
        // oxlint-disable-next-line typescript/no-unsafe-assignment
        const wire: typeof snapshot = JSON.parse(json);
        hydrate(browser, {
          ...wire,
          queries: yield* registry.decodeQueries(wire.queries),
        });
        const metadata = browser.getQueryData(options.queryKey);
        expect(metadata?.data.body).toBeInstanceOf(Profile);
        expect(metadata?.data.headers["x-version"]).toBe(7);
        expect(metadata?.headers["etag"]).toBe("public");
        expect(Object.isFrozen(metadata)).toBe(false);
        yield* Effect.promise(async () => await browser.query(options));
        expect({
          metadata: Object.isFrozen(browser.getQueryData(options.queryKey)),
          headers: Object.isFrozen(
            browser.getQueryData(options.queryKey)?.headers
          ),
        }).toStrictEqual({ metadata: true, headers: true });
      } finally {
        server.clear();
        browser.clear();
      }
    })
);

it.effect(
  "supports native serialization callbacks for a service-free leaf and view",
  () =>
    Effect.gen(function* serializesThroughNativeCallbacks() {
      const client = yield* makeRpcTestClient(group, {
        read: () => Effect.succeed(profile),
        watch: () => Stream.empty,
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["callbacks"],
      });
      const codec = queryViewCodec(rpc.read, "query", Profile);
      const { serializeData, deserializeData } = hydrationCallbacks(codec);
      const server = new QueryClient();
      const browser = new QueryClient();
      try {
        yield* Effect.promise(
          async () =>
            await server.query(rpc.read.queryOptions({ input: { id: 2 } }))
        );
        const snapshot = dehydrate(server, {
          shouldDehydrateMutation: () => false,
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" && codec.matches(query.queryKey),
          serializeData,
        });
        const json = JSON.stringify(snapshot);
        // oxlint-disable-next-line typescript/no-unsafe-assignment
        const wire: typeof snapshot = JSON.parse(json);
        hydrate(browser, wire, {
          defaultOptions: { deserializeData },
        });
        expect(
          browser.getQueryData(rpc.read.queryKey({ id: 2 }))
        ).toBeInstanceOf(Profile);
      } finally {
        server.clear();
        browser.clear();
      }
    })
);

class Preparation extends Context.Service<
  Preparation,
  { readonly ready: Effect.Effect<void> }
>()("RegistryPreparation") {}

it.effect(
  "awaits service-dependent preparation and rejects a later invalid query before hydration",
  () =>
    Effect.gen(function* awaitsHydrationPreparation() {
      const client = yield* makeRpcTestClient(group, {
        read: () => Effect.succeed(profile),
        watch: () => Stream.empty,
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["preparation"],
      });
      const preparedProfile = Profile.pipe(
        Schema.middlewareDecoding((decode) =>
          Preparation.pipe(
            Effect.flatMap(({ ready }) => ready.pipe(Effect.andThen(decode)))
          )
        )
      );
      const registry = createHydrationRegistry([
        queryViewCodec(rpc.read, "query", preparedProfile),
      ]);
      const server = new QueryClient();
      const browser = new QueryClient();
      try {
        yield* Effect.promise(
          async () =>
            await server.query(rpc.read.queryOptions({ input: { id: 1 } }))
        );
        yield* Effect.promise(
          async () =>
            await server.query(rpc.read.queryOptions({ input: { id: 2 } }))
        );
        const snapshot = dehydrate(server, {
          shouldDehydrateMutation: () => false,
        });
        const queries = yield* registry.encodeQueries(snapshot.queries);
        const started = yield* Deferred.make<boolean>();
        const release = yield* Deferred.make<boolean>();
        const hydration = yield* Effect.forkChild(
          registry.decodeQueries(queries).pipe(
            Effect.provideService(Preparation, {
              ready: Deferred.succeed(started, true).pipe(
                Effect.andThen(Deferred.await(release))
              ),
            }),
            Effect.tap((decoded) =>
              Effect.sync(() => {
                hydrate(browser, { ...snapshot, queries: decoded });
              })
            )
          )
        );
        yield* Deferred.await(started);
        expect(browser.getQueryCache().getAll()).toHaveLength(0);
        yield* Deferred.succeed(release, true);
        yield* Fiber.join(hydration);
        expect(
          browser.getQueryData(rpc.read.queryKey({ id: 1 }))
        ).toBeInstanceOf(Profile);
        browser.clear();
        browser.setQueryData(["existing"], "untouched");
        const current = [...browser.getQueryCache().getAll()];
        const invalid = queries.map((query, index) =>
          index === 1
            ? { ...query, state: { ...query.state, data: { malformed: true } } }
            : query
        );
        const exit = yield* Effect.exit(
          registry.decodeQueries(invalid).pipe(
            Effect.provideService(Preparation, { ready: Effect.void }),
            Effect.tap((decoded) =>
              Effect.sync(() => {
                hydrate(browser, { ...snapshot, queries: decoded });
              })
            )
          )
        );
        expect(exit._tag).toBe("Failure");
        expect(browser.getQueryCache().getAll()).toStrictEqual(current);
        expect({
          existing: browser.getQueryData(["existing"]),
          decoded: browser.getQueryData(rpc.read.queryKey({ id: 1 })),
        }).toStrictEqual({ existing: "untouched", decoded: undefined });
      } finally {
        server.clear();
        browser.clear();
      }
    })
);

it.effect(
  "rejects duplicate registrations, unknown queries and pending promises explicitly",
  () =>
    Effect.gen(function* rejectsInvalidHydrationRegistrations() {
      const client = yield* makeRpcTestClient(group, {
        read: () => Effect.succeed(profile),
        watch: () => Stream.empty,
      });
      const rpc = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["registry-errors"],
      });
      const codec = queryViewCodec(rpc.read, "query", Profile);
      expect(() => createHydrationRegistry([codec, codec])).toThrow(
        HydrationCodecError
      );
      const registry = createHydrationRegistry([codec]);
      const queryClient = new QueryClient();
      try {
        queryClient.setQueryData(["foreign"], profile);
        expect(registry.matches(["foreign"])).toBe(false);
        const snapshot = dehydrate(queryClient);
        const unknown = yield* Effect.result(
          registry.encodeQueries(snapshot.queries)
        );
        expect(unknown).toMatchObject({
          _tag: "Failure",
          failure: { code: "UnknownQuery" },
        });
        queryClient.clear();
        queryClient.setQueryData(rpc.read.queryKey({ id: 1 }), profile);
        const queries = dehydrate(queryClient).queries.map((query) => ({
          ...query,
          promise: Promise.resolve(profile),
        }));
        const pending = yield* Effect.result(registry.encodeQueries(queries));
        expect(pending).toMatchObject({
          _tag: "Failure",
          failure: { code: "UnsettledQuery" },
        });
      } finally {
        queryClient.clear();
      }
    })
);
