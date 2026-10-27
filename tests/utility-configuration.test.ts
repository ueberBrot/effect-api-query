import { expect, it } from "@effect/vitest";
import { QueryClient, skipToken } from "@tanstack/query-core";
import { Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  configureUtils,
  createRpcQueryUtils,
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
