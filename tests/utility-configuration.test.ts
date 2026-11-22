import { expect, it } from "@effect/vitest";
import { QueryClient, skipToken } from "@tanstack/query-core";
import { Effect, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  defineHttpApiPolicy,
  prepareInput,
} from "#effect-api-query";

import { group, makeClient, makeRpcTestClient } from "./fixtures/effect-rpc";

it.effect("applies root, branch, leaf, and local query defaults in order", () =>
  Effect.gen(function* appliesDefaults() {
    const client = yield* makeClient();
    const rpc = configureUtils(
      createRpcQueryUtils(group, { client, keyPrefix: ["configured"] }),
      {
        query: { retry: false, staleTime: 100 },
        paths: {
          "users.get": { query: { staleTime: 1000 } },
          users: { query: { gcTime: 5000, staleTime: 200 } },
        },
      }
    );
    const options = rpc.users.get.queryOptions({
      input: { id: 7 },
      staleTime: 2000,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 3, staleTime: 50 } },
    });
    try {
      expect(queryClient.defaultQueryOptions(options)).toMatchObject({
        gcTime: 5000,
        retry: false,
        staleTime: 2000,
      });
      expect(rpc.users.get.queryOptions({ input: skipToken }).queryFn).toBe(
        skipToken
      );
      expect(
        yield* Effect.promise(async () => await queryClient.query(options))
      ).toStrictEqual({ id: 7, locale: "en", name: "Ada" });
    } finally {
      queryClient.clear();
    }
  })
);

it.effect(
  "inherits retention for keys and options and permits explicit full history",
  () =>
    Effect.gen(function* inheritsRetention() {
      const history = RpcGroup.make(
        Rpc.make("events", { success: Schema.Int, stream: true })
      );
      const client = yield* makeRpcTestClient(history, {
        events: () => Stream.make(1, 2, 3),
      });
      const base = createRpcQueryUtils(history, {
        client,
        keyPrefix: ["configured-history"],
      });
      const rpc = configureUtils(base, {
        streamed: { maxChunks: 2 },
      });
      const queryClient = new QueryClient();
      try {
        expect(rpc.events.streamedKey()).toStrictEqual(
          base.events.streamedKey({ maxChunks: 2 })
        );
        expect(
          yield* Effect.promise(
            async () => await queryClient.query(rpc.events.streamedOptions())
          )
        ).toStrictEqual([2, 3]);
        expect(
          yield* Effect.promise(
            async () =>
              await queryClient.query(
                rpc.events.streamedOptions({ maxChunks: "unbounded" })
              )
          )
        ).toStrictEqual([1, 2, 3]);
      } finally {
        queryClient.clear();
      }
    })
);

it.effect(
  "keeps prepared inputs and typed cache keys on configured leaves",
  () =>
    Effect.gen(function* keepsPreparation() {
      const client = yield* makeClient();
      const base = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["configured-input"],
      });
      const input = prepareInput(base.users.get, { id: 9 });
      const rpc = configureUtils(base, {
        query: { staleTime: 1000 },
      });
      const queryClient = new QueryClient();
      try {
        const data = yield* Effect.promise(
          async () =>
            await queryClient.query(rpc.users.get.queryOptions({ input }))
        );
        expect(
          queryClient.getQueryData(base.users.get.queryKey({ input }))
        ).toBe(data);
        expect(Object.isFrozen(rpc.users.get)).toBe(true);
      } finally {
        queryClient.clear();
      }
    })
);

it.effect("runs inherited interceptors outside leaf interceptors", () =>
  Effect.gen(function* ordersInterceptors() {
    const client = yield* makeClient();
    const calls: string[] = [];
    const rpc = configureUtils(
      createRpcQueryUtils(group, { client, keyPrefix: ["configured-attempt"] }),
      {
        query: {
          interceptors: [
            async ({ next: execute }) => {
              calls.push("root query");
              const data = await execute();
              calls.push("root query done");
              return data;
            },
          ],
        },
        mutation: {
          callbacks: "compose",
          onSuccess: () => {
            calls.push("root success");
          },
          interceptors: [
            async ({ next: execute }) => {
              calls.push("root mutation");
              return await execute();
            },
          ],
        },
        paths: {
          "users.get": {
            query: {
              interceptors: [
                async ({ next: execute }) => {
                  calls.push("leaf query");
                  return await execute();
                },
              ],
            },
            mutation: {
              callbacks: "compose",
              onSuccess: () => {
                calls.push("leaf success");
              },
              interceptors: [
                async ({ next: execute }) => {
                  calls.push("leaf mutation");
                  return await execute();
                },
              ],
            },
          },
        },
      }
    );
    const queryClient = new QueryClient();
    try {
      yield* Effect.promise(
        async () =>
          await queryClient.query(
            rpc.users.get.queryOptions({ input: { id: 1 } })
          )
      );
      const mutation = queryClient.getMutationCache().build(
        queryClient,
        rpc.users.get.mutationOptions({
          onSuccess: () => {
            calls.push("local success");
          },
        })
      );
      yield* Effect.promise(async () => await mutation.execute({ id: 2 }));
      expect(calls).toStrictEqual([
        "root query",
        "leaf query",
        "root query done",
        "root mutation",
        "leaf mutation",
        "root success",
        "leaf success",
        "local success",
      ]);
    } finally {
      queryClient.clear();
    }
  })
);

it.effect("reuses unaffected configured branches in a sparse snapshot", () =>
  Effect.gen(function* reusesBranches() {
    const client = yield* makeClient();
    const base = configureUtils(
      createRpcQueryUtils(group, { client, keyPrefix: ["sparse-snapshot"] }),
      { query: { staleTime: 100 } }
    );
    const input = prepareInput(base.users.get, { id: 9 });
    const settings = { query: { staleTime: 200 } };
    const configured = configureUtils(base, {
      paths: {
        "users.get": settings,
      },
    });
    settings.query.staleTime = 999;
    const later = configureUtils(configured, {
      query: { gcTime: 500 },
    });
    const queryClient = new QueryClient();
    try {
      expect({
        sameHealth: configured.health === base.health,
        sameEvents: configured.events === base.events,
        sameUsers: configured.users === base.users,
        laterSameHealth: later.health === configured.health,
        frozen: [configured, configured.users, configured.users.get].every(
          Object.isFrozen
        ),
      }).toStrictEqual({
        sameHealth: true,
        sameEvents: true,
        sameUsers: false,
        laterSameHealth: false,
        frozen: true,
      });
      expect(later.users.get.queryOptions({ input })).toMatchObject({
        staleTime: 200,
        gcTime: 500,
      });
      expect(
        queryClient.defaultQueryOptions(base.users.get.queryOptions({ input }))
          .staleTime
      ).toBe(100);
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(later.users.get.queryOptions({ input }))
        )
      ).toStrictEqual({ id: 9, locale: "en", name: "Ada" });
      expect(
        yield* Effect.promise(
          async () => await queryClient.query(later.health.ping.queryOptions())
        )
      ).toBeNull();
    } finally {
      queryClient.clear();
    }
  })
);

it.effect("keeps the frozen tree for empty configuration scopes", () =>
  Effect.gen(function* keepsEmptyConfiguration() {
    const client = yield* makeClient();
    const base = createRpcQueryUtils(group, {
      client,
      keyPrefix: ["empty-configuration"],
    });
    const configured = configureUtils(base, {
      query: { interceptors: [] },
      paths: {
        "users.get": {},
      },
    });
    expect(configured).toBe(base);
    const queryClient = new QueryClient();
    try {
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(configured.health.ping.queryOptions())
        )
      ).toBeNull();
    } finally {
      queryClient.clear();
    }
  })
);

it.effect(
  "inherits sseOptions on HTTP SSE keys and options with local override precedence",
  () =>
    Effect.gen(function* inheritsSseOptions() {
      const eventSchema = Schema.Struct({
        event: Schema.String,
        data: Schema.String,
      });
      const api = HttpApi.make("configured-sse").add(
        HttpApiGroup.make("events").add(
          HttpApiEndpoint.get("watch", "/watch", {
            success: HttpApiSchema.StreamSse({
              events: eventSchema,
            }),
          }),
          HttpApiEndpoint.get("channel", "/channels/:id", {
            params: { id: Schema.String },
            success: HttpApiSchema.StreamSse({
              events: eventSchema,
            }),
          })
        )
      );
      const sseBody =
        "event: state\n\nevent: state\ndata: one\n\nevent: state\ndata: two\n\n";
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: "https://example.test",
        httpClient: HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(sseBody, {
                headers: { "content-type": "text/event-stream" },
                status: 200,
              })
            )
          )
        ),
      });
      const base = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ["configured-sse"],
      });
      const inheritedSse = {
        maxEventSize: 128,
        dispatchEmptyNamedEvents: true,
      };
      const callerSse = { ...inheritedSse };
      const overrideSse = {
        maxEventSize: 64,
        dispatchEmptyNamedEvents: false,
      };
      const policy = defineHttpApiPolicy(
        api,
        {
          paths: {
            "events.watch": {
              streamed: { maxChunks: 3, sseOptions: callerSse },
              live: { sseOptions: callerSse },
            },
            "events.channel": {
              streamed: { maxChunks: 3, sseOptions: callerSse },
              live: { sseOptions: callerSse },
            },
          },
        },
        { keyPrefix: ["configured-sse"] }
      );
      const configured = configureUtils(base, policy);
      callerSse.maxEventSize = 256;
      callerSse.dispatchEmptyNamedEvents = false;
      const channelInput = { params: { id: "alpha" } };
      const queryClient = new QueryClient();
      try {
        const inheritedStreamedOptions =
          configured.events.watch.streamedOptions();
        const inheritedStreamedResult = yield* Effect.promise(
          async () => await queryClient.query(inheritedStreamedOptions)
        );
        expect({
          key: inheritedStreamedOptions.queryKey,
          configuredKey: configured.events.watch.streamedKey(),
          result: inheritedStreamedResult,
          cached: queryClient.getQueryData(
            configured.events.watch.streamedKey()
          ),
        }).toStrictEqual({
          key: base.events.watch.streamedKey({
            maxChunks: 3,
            sseOptions: inheritedSse,
          }),
          configuredKey: base.events.watch.streamedKey({
            maxChunks: 3,
            sseOptions: inheritedSse,
          }),
          result: [
            { event: "state", data: "" },
            { event: "state", data: "one" },
            { event: "state", data: "two" },
          ],
          cached: [
            { event: "state", data: "" },
            { event: "state", data: "one" },
            { event: "state", data: "two" },
          ],
        });

        const overrideStreamedOptions = configured.events.watch.streamedOptions(
          { sseOptions: overrideSse }
        );
        const overrideStreamedResult = yield* Effect.promise(
          async () => await queryClient.query(overrideStreamedOptions)
        );
        expect({
          key: overrideStreamedOptions.queryKey,
          configuredKey: configured.events.watch.streamedKey({
            sseOptions: overrideSse,
          }),
          result: overrideStreamedResult,
          cached: queryClient.getQueryData(
            configured.events.watch.streamedKey({ sseOptions: overrideSse })
          ),
        }).toStrictEqual({
          key: base.events.watch.streamedKey({
            maxChunks: 3,
            sseOptions: overrideSse,
          }),
          configuredKey: base.events.watch.streamedKey({
            maxChunks: 3,
            sseOptions: overrideSse,
          }),
          result: [
            { event: "state", data: "one" },
            { event: "state", data: "two" },
          ],
          cached: [
            { event: "state", data: "one" },
            { event: "state", data: "two" },
          ],
        });

        const inheritedLiveOptions = configured.events.watch.liveOptions();
        const inheritedLiveResult = yield* Effect.promise(
          async () => await queryClient.query(inheritedLiveOptions)
        );
        expect({
          key: inheritedLiveOptions.queryKey,
          configuredKey: configured.events.watch.liveKey(),
          result: inheritedLiveResult,
          overrideKey: configured.events.watch.liveKey({
            sseOptions: overrideSse,
          }),
          resetKey: configured.events.watch.liveKey({ sseOptions: undefined }),
        }).toStrictEqual({
          key: base.events.watch.liveKey({ sseOptions: inheritedSse }),
          configuredKey: base.events.watch.liveKey({
            sseOptions: inheritedSse,
          }),
          result: { event: "state", data: "two" },
          overrideKey: base.events.watch.liveKey({ sseOptions: overrideSse }),
          resetKey: base.events.watch.liveKey(),
        });

        const channelStreamedOptions =
          configured.events.channel.streamedOptions({ input: channelInput });
        const channelOverrideLiveOptions =
          configured.events.channel.liveOptions({
            input: channelInput,
            sseOptions: overrideSse,
          });
        expect({
          streamedKey: configured.events.channel.streamedKey({
            input: channelInput,
          }),
          streamedOptionsKey: channelStreamedOptions.queryKey,
          streamedOverrideKey: configured.events.channel.streamedKey({
            input: channelInput,
            sseOptions: overrideSse,
          }),
          liveKey: configured.events.channel.liveKey({ input: channelInput }),
          liveOverrideKey: configured.events.channel.liveKey({
            input: channelInput,
            sseOptions: overrideSse,
          }),
          liveOverrideOptionsKey: channelOverrideLiveOptions.queryKey,
        }).toStrictEqual({
          streamedKey: base.events.channel.streamedKey({
            input: channelInput,
            maxChunks: 3,
            sseOptions: inheritedSse,
          }),
          streamedOptionsKey: base.events.channel.streamedKey({
            input: channelInput,
            maxChunks: 3,
            sseOptions: inheritedSse,
          }),
          streamedOverrideKey: base.events.channel.streamedKey({
            input: channelInput,
            maxChunks: 3,
            sseOptions: overrideSse,
          }),
          liveKey: base.events.channel.liveKey({
            input: channelInput,
            sseOptions: inheritedSse,
          }),
          liveOverrideKey: base.events.channel.liveKey({
            input: channelInput,
            sseOptions: overrideSse,
          }),
          liveOverrideOptionsKey: base.events.channel.liveKey({
            input: channelInput,
            sseOptions: overrideSse,
          }),
        });
      } finally {
        queryClient.clear();
      }
    })
);

it.effect(
  "resolves literal HTTP identifiers and rejects only ambiguous selected paths",
  () =>
    Effect.gen(function* resolvesDottedPaths() {
      const api = HttpApi.make("dotted-policies").add(
        HttpApiGroup.make("user.accounts").add(
          HttpApiEndpoint.get("get.user", "/accounts/user", {
            success: Schema.Int,
          }),
          HttpApiEndpoint.get("get.team", "/accounts/team", {
            success: Schema.Int,
          })
        ),
        HttpApiGroup.make("user").add(
          HttpApiEndpoint.get("accounts.get.user", "/user", {
            success: Schema.Int,
          })
        ),
        HttpApiGroup.make("root", { topLevel: true }).add(
          HttpApiEndpoint.get("admin.toString", "/admin", {
            success: Schema.Int,
          }),
          HttpApiEndpoint.get("toString", "/name", { success: Schema.Int })
        )
      );
      const client = yield* HttpApiClient.makeWith(api, {
        httpClient: HttpClient.make(() =>
          Effect.die("Unexpected HTTP request")
        ),
      });
      const base = createHttpApiQueryUtils(api, { client });
      const policy = defineHttpApiPolicy(api, {
        paths: {
          "user.accounts.get.team": { query: { staleTime: 200 } },
          "user.accounts": { query: { staleTime: 100 } },
          "admin.toString": { query: { staleTime: 300 } },
          toString: { query: { staleTime: 400 } },
        },
      });
      const configured = configureUtils(base, policy);
      expect(configured.user).toBe(base.user);
      expect({
        team: configured["user.accounts"]["get.team"].queryOptions(),
        user: configured["user.accounts"]["get.user"].queryOptions(),
        admin: configured["admin.toString"].queryOptions(),
        name: configured.toString.queryOptions(),
      }).toMatchObject({
        team: { staleTime: 200 },
        user: { staleTime: 100 },
        admin: { staleTime: 300 },
        name: { staleTime: 400 },
      });
      expect(() =>
        configureUtils(base, {
          paths: { "user.accounts.get.user": { query: { staleTime: 500 } } },
        })
      ).toThrow("Ambiguous utility path: user.accounts.get.user");
      const branch = configureUtils(configured["user.accounts"], {
        paths: { "get.user": { query: { staleTime: 600 } } },
      });
      expect(branch["get.user"].queryOptions()).toMatchObject({
        staleTime: 600,
      });
    })
);

it.effect(
  "validates JavaScript policy maps before returning configured utilities",
  () =>
    Effect.gen(function* rejectsInvalidSettings() {
      const client = yield* makeClient();
      const base = createRpcQueryUtils(group, { client });
      const unknownPath = Object.fromEntries([
        ["paths", { "users.missing": {} }],
      ]);
      const unknownOption = Object.fromEntries([
        ["paths", { "users.get": { query: { retrry: false } } }],
      ]);
      const leafPaths = Object.fromEntries([["paths", {}]]);
      expect(() =>
        configureUtils<typeof base, object>(base, unknownPath)
      ).toThrow("Unknown utility path: users.missing");
      expect(() =>
        configureUtils<typeof base, object>(base, unknownOption)
      ).toThrow("Unknown query configuration option: retrry");
      expect(() =>
        configureUtils<typeof base.users.get, object>(base.users.get, leafPaths)
      ).toThrow("Unknown utility configuration option: paths");
    })
);
