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
  defineUtilsPolicy,
  prepareInput,
} from "#effect-api-query";

import { group, makeClient, makeRpcTestClient } from "./fixtures/effect-rpc";

it.effect("applies root, branch, leaf, and local query defaults in order", () =>
  Effect.gen(function* appliesDefaults() {
    const client = yield* makeClient();
    const rpc = configureUtils(
      createRpcQueryUtils(group, { client, keyPrefix: ["configured"] }),
      {
        query: { policy: { retry: false, staleTime: 100 } },
        scoped: {
          users: {
            query: { policy: { gcTime: 5000 } },
            scoped: {
              get: { query: { policy: { staleTime: 1000 } } },
            },
          },
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
        streamed: { policy: { maxChunks: 2 } },
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
        query: { policy: { staleTime: 1000 } },
      });
      const queryClient = new QueryClient();
      try {
        const data = yield* Effect.promise(
          async () =>
            await queryClient.query(rpc.users.get.queryOptions({ input }))
        );
        expect(queryClient.getQueryData(base.users.get.queryKey(input))).toBe(
          data
        );
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
          policy: {
            onSuccess: () => {
              calls.push("root success");
            },
          },
          interceptors: [
            async ({ next: execute }) => {
              calls.push("root mutation");
              return await execute();
            },
          ],
        },
        scoped: {
          users: {
            scoped: {
              get: {
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
                  policy: {
                    onSuccess: () => {
                      calls.push("leaf success");
                    },
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
      { query: { policy: { staleTime: 100 } } }
    );
    const input = prepareInput(base.users.get, { id: 9 });
    const settings = { query: { policy: { staleTime: 200 } } };
    const configured = configureUtils(base, {
      scoped: { users: { scoped: { get: settings } } },
    });
    settings.query.policy.staleTime = 999;
    const later = configureUtils(configured, {
      query: { policy: { gcTime: 500 } },
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
      query: { policy: {}, interceptors: [] },
      scoped: { users: { scoped: { get: {} } } },
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
      const overrideSse = {
        maxEventSize: 64,
        dispatchEmptyNamedEvents: false,
      };
      const policy = defineUtilsPolicy<typeof base>()({
        scoped: {
          events: {
            scoped: {
              watch: {
                streamed: {
                  policy: { maxChunks: 3, sseOptions: inheritedSse },
                },
                live: {
                  policy: { sseOptions: inheritedSse },
                },
              },
              channel: {
                streamed: {
                  policy: { maxChunks: 3, sseOptions: inheritedSse },
                },
                live: {
                  policy: { sseOptions: inheritedSse },
                },
              },
            },
          },
        },
      });
      const configured = configureUtils(base, policy);
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
          streamedKey: configured.events.channel.streamedKey(channelInput),
          streamedOptionsKey: channelStreamedOptions.queryKey,
          streamedOverrideKey: configured.events.channel.streamedKey(
            channelInput,
            { sseOptions: overrideSse }
          ),
          liveKey: configured.events.channel.liveKey(channelInput),
          liveOverrideKey: configured.events.channel.liveKey(channelInput, {
            sseOptions: overrideSse,
          }),
          liveOverrideOptionsKey: channelOverrideLiveOptions.queryKey,
        }).toStrictEqual({
          streamedKey: base.events.channel.streamedKey(channelInput, {
            maxChunks: 3,
            sseOptions: inheritedSse,
          }),
          streamedOptionsKey: base.events.channel.streamedKey(channelInput, {
            maxChunks: 3,
            sseOptions: inheritedSse,
          }),
          streamedOverrideKey: base.events.channel.streamedKey(channelInput, {
            maxChunks: 3,
            sseOptions: overrideSse,
          }),
          liveKey: base.events.channel.liveKey(channelInput, {
            sseOptions: inheritedSse,
          }),
          liveOverrideKey: base.events.channel.liveKey(channelInput, {
            sseOptions: overrideSse,
          }),
          liveOverrideOptionsKey: base.events.channel.liveKey(channelInput, {
            sseOptions: overrideSse,
          }),
        });
      } finally {
        queryClient.clear();
      }
    })
);
