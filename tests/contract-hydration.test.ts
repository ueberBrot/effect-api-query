import { describe, it } from "@effect/vitest";
import { dehydrate, hydrate, QueryClient } from "@tanstack/query-core";
import {
  Context,
  Effect,
  Layer,
  ManagedRuntime,
  Predicate,
  Schema,
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
  // oxlint-disable-next-line typescript/no-unsafe-assignment
  const wire: typeof snapshot = JSON.parse(json);
  const decoded = yield* registry.decodeQueries(wire.queries);
  hydrate(browser, { ...wire, queries: decoded });
});

const dummyHttpClient = HttpClient.make((request) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }))
  )
);

describe("createContractHydrationRegistry — RPC contracts", () => {
  it.effect(
    "round-trips unary, void, optional, infinite, live, and streamed RPC views with default empty keyPrefix",
    () =>
      Effect.gen(function* roundTripsRpcViews() {
        const group = RpcGroup.make(
          Rpc.make("users.read", {
            payload: { id: Schema.Int },
            success: Profile,
          }),
          Rpc.make("health.ping", { success: Schema.Void }),
          Rpc.make("users.optional", { success: Schema.UndefinedOr(Profile) }),
          Rpc.make("events.watch", {
            success: Schema.UndefinedOr(Schema.NullOr(Profile)),
            stream: true,
          })
        );
        const client = yield* makeRpcTestClient(group, {
          "users.read": () => Effect.succeed(profile),
          "health.ping": () => Effect.void,
          "users.optional": () => Effect.undefined,
          "events.watch": () => Stream.fromIterable([profile, undefined, null]),
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
            page: expect.any(Profile),
            cursor: expect.any(Cursor),
            offset: 0n,
            streamed: [expect.any(Profile), undefined, null],
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
        const registry = createContractHydrationRegistry(api);

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
                data: Schema.UndefinedOr(Schema.NullOr(Profile)),
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
        const registry = createContractHydrationRegistry(api);
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

          server.setQueryData(sseDataStreamKey, [profile, undefined, null]);
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
            sseDataStream: [expect.any(Profile), undefined, null],
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
        paths: { "boxes.get": { query: OpaqueCodec } },
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

    const expected = {
      emptyPrefix: { code: "InvalidKeyPrefix" },
      nonJsonPrefix: { code: "InvalidKeyPrefix" },
      unknownPath: { code: "UnknownPath", path: "users.missing" },
      ambiguous: { code: "InvalidContractPath", path: "a.b.c" },
    } as const;

    expect({
      emptyPrefix: { code: emptyPrefixErr.code },
      nonJsonPrefix: { code: nonJsonPrefixErr.code },
      unknownPath: { code: unknownPathErr.code, path: unknownPathErr.path },
      ambiguous: { code: ambiguousErr.code, path: ambiguousErr.path },
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

class DecodeSvc extends Context.Service<DecodeSvc, { readonly tag: string }>()(
  "ComposeDecodeSvc"
) {}

describe("composable createHydrationRegistry", () => {
  it.effect(
    "flattens package registries alongside manual codecs, preserves DuplicateCodec & longest-prefix, and rejects structural fakes",
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
});
