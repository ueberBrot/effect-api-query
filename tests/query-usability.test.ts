import { describe, expect, it } from "@effect/vitest";
import { QueryClient, skipToken } from "@tanstack/query-core";
import { Cause, Effect, Exit, Option, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  configureUtils,
  consumeEvents,
  createBranchQueryFilter,
  createRpcQueryUtils,
  createHttpApiQueryUtils,
  EffectRpcQueryError,
  findDeclaredError,
  prepareInput,
} from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc";

const group = RpcGroup.make(
  Rpc.make("users.read", { payload: { id: Schema.Int }, success: Schema.Int }),
  Rpc.make("users.nested.read", {
    payload: { id: Schema.Int },
    success: Schema.Int,
  }),
  Rpc.make("users.watch", {
    payload: { id: Schema.Int },
    success: Schema.Int,
    stream: true,
  })
);
const handlers = group.of({
  "users.read": ({ id }) => Effect.succeed(id),
  "users.nested.read": ({ id }) => Effect.succeed(id),
  "users.watch": ({ id }) => Stream.make(id),
});
describe("query usability", () => {
  it.effect("reuses preparation across views and rejects another owner", () =>
    Effect.gen(function* reusesPreparation() {
      const client = yield* makeRpcTestClient(group, handlers);
      let encoded = 0;
      const make = () =>
        createRpcQueryUtils(group, {
          client,
          keyPrefix: ["prepared"],
          keyEncoders: {
            "users.read": (input) => {
              encoded += 1;
              return input;
            },
          },
        });
      const rpc = make();
      const input = prepareInput(rpc.users.read, { id: 7 });
      const options = rpc.users.read.queryOptions({ input });
      expect({
        encoded,
        key: rpc.users.read.queryKey(input),
        infinite: rpc.users.read.infiniteKey(input),
      }).toStrictEqual({
        encoded: 1,
        key: options.queryKey,
        infinite: ["prepared", "rpc", "users", "read", "infinite", { id: 7 }],
      });
      const queryClient = new QueryClient();
      try {
        expect(
          yield* Effect.promise(async () => await queryClient.query(options))
        ).toBe(7);
        expect(() => make().users.read.queryOptions({ input })).toThrow(
          "another utility leaf"
        );
        expect(() => rpc.users.nested.read.queryKey(input)).toThrow(
          "another utility leaf"
        );
        const configured = configureUtils(rpc.users.read, {
          query: {
            policy: { staleTime: 100 },
          },
        });
        const again = prepareInput(configured, { id: 8 });
        expect(
          yield* Effect.promise(
            async () =>
              await queryClient.query(configured.queryOptions({ input: again }))
          )
        ).toBe(8);
        const watch = prepareInput(rpc.users.watch, { id: 9 });
        expect(
          yield* Effect.promise(
            async () =>
              await queryClient.query(
                rpc.users.watch.streamedOptions({
                  maxChunks: "unbounded",
                  input: watch,
                })
              )
          )
        ).toStrictEqual([9]);
      } finally {
        queryClient.clear();
      }
    })
  );
  it.effect(
    "configures query and mutation views together with ordered interception",
    () =>
      Effect.gen(function* configuresViews() {
        const client = yield* makeRpcTestClient(group, handlers);
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["composition"],
        });
        const calls: string[] = [];
        const leaf = configureUtils(rpc.users.read, {
          query: {
            policy: { staleTime: 1000 },
            interceptors: [
              async ({ next: execute }) => {
                calls.push("outer");
                const value = await execute();
                calls.push("outer done");
                return value;
              },
              async ({ next }) => {
                calls.push("inner");
                return await next();
              },
            ],
          },
          mutation: {
            policy: {
              onSuccess: () => {
                calls.push("shared success");
              },
            },
            callbacks: "compose",
            interceptors: [
              async ({ next }) => {
                calls.push("mutation");
                return await next();
              },
            ],
          },
        });
        const options = leaf.queryOptions({
          input: { id: 1 },
          staleTime: 2000,
        });
        const queryClient = new QueryClient();
        try {
          expect(options.staleTime).toBe(2000);
          expect(leaf.queryOptions({ input: skipToken }).queryFn).toBe(
            skipToken
          );
          expect(
            yield* Effect.promise(async () => await queryClient.query(options))
          ).toBe(1);
          const mutation = queryClient.getMutationCache().build(
            queryClient,
            leaf.mutationOptions({
              onSuccess: () => {
                calls.push("local success");
              },
            })
          );
          expect(
            yield* Effect.promise(async () => await mutation.execute({ id: 2 }))
          ).toBe(2);
          expect(calls).toStrictEqual([
            "outer",
            "inner",
            "outer done",
            "mutation",
            "shared success",
            "local success",
          ]);
        } finally {
          queryClient.clear();
        }
      })
  );
  it.effect(
    "filters a branch view across nested leaves and composes native predicates",
    () =>
      Effect.gen(function* filtersViews() {
        const client = yield* makeRpcTestClient(group, handlers);
        const rpc = createRpcQueryUtils(group, {
          client,
          keyPrefix: [{ tenant: "one" }],
        });
        const queryClient = new QueryClient();
        try {
          queryClient.setQueryData(rpc.users.read.queryKey({ id: 1 }), 1);
          queryClient.setQueryData(
            rpc.users.nested.read.queryKey({ id: 2 }),
            2
          );
          queryClient.setQueryData(rpc.users.read.infiniteKey({ id: 1 }), {
            pages: [1],
            pageParams: [0],
          });
          queryClient.setQueryData(rpc.users.watch.liveKey({ id: 1 }), 1);
          const filter = createBranchQueryFilter(rpc.users, "query");
          yield* Effect.promise(async () => {
            await queryClient.invalidateQueries(filter());
          });
          expect(
            queryClient
              .getQueryCache()
              .findAll({ predicate: (query) => query.state.isInvalidated })
          ).toHaveLength(2);
          expect(
            queryClient.getQueriesData(
              filter({ predicate: (query) => query.state.data === 2 })
            )
          ).toHaveLength(1);
          expect(
            queryClient.getQueriesData(
              createBranchQueryFilter(rpc, "metadata")()
            )
          ).toHaveLength(0);
        } finally {
          queryClient.clear();
        }
      })
  );
});
describe("typed failures", () => {
  it("matches typed failures without hiding compound causes or defects", () => {
    const failure = { _tag: "NotFound", id: 1 } as const;
    const error = new EffectRpcQueryError("read", "query", Cause.fail(failure));
    expect(findDeclaredError(error, "NotFound")).toStrictEqual(
      Option.some(failure)
    );
    const defect = new EffectRpcQueryError<typeof failure>(
      "read",
      "query",
      Cause.die(failure)
    );
    expect(findDeclaredError(defect, "NotFound")).toStrictEqual(Option.none());
    const compound = new EffectRpcQueryError(
      "read",
      "query",
      Cause.combine(Cause.fail(failure), Cause.die("defect"))
    );
    expect(findDeclaredError(compound, "NotFound")).toStrictEqual(
      Option.none()
    );
  });
});
it.effect(
  "consumes sequentially, awaits cleanup, and preserves handler failure",
  () =>
    Effect.gen(function* consumesEvents() {
      const events: string[] = [];
      const source = Stream.make(1, 2, 3).pipe(
        Stream.ensuring(
          Effect.sync(() => {
            events.push("cleanup");
          })
        )
      );
      const exit = yield* Effect.exit(
        consumeEvents(source, {
          onStart: Effect.sync(() => {
            events.push("start");
          }),
          onEvent: (value) =>
            Effect.gen(function* onEvent() {
              events.push(String(value));
              if (value === 2) {
                return yield* Effect.fail("handler failed");
              }
              return yield* Effect.void;
            }),
          onExit: () =>
            Effect.sync(() => {
              events.push("exit");
            }),
        })
      );
      expect(exit).toStrictEqual(Exit.fail("handler failed"));
      expect(events).toStrictEqual(["start", "1", "2", "cleanup", "exit"]);
    })
);
it.effect("reuses HTTP preparation for buffered and metadata views", () =>
  Effect.gen(function* preparesHttp() {
    const api = HttpApi.make("prepared").add(
      HttpApiGroup.make("users").add(
        HttpApiEndpoint.get("read", "/users/:id", {
          params: { id: Schema.Int },
          success: Schema.Int,
        })
      )
    );
    const client = yield* HttpApiClient.makeWith(api, {
      baseUrl: "https://example.test",
      httpClient: HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("7", {
              headers: { "content-type": "application/json" },
            })
          )
        )
      ),
    });
    let encoded = 0;
    const http = createHttpApiQueryUtils(api, {
      client,
      keyPrefix: ["prepared"],
      keyEncoders: {
        users: {
          read: (input) => {
            encoded += 1;
            return input;
          },
        },
      },
    });
    const input = prepareInput(http.users.read, { params: { id: 7 } });
    const queryClient = new QueryClient();
    try {
      expect(
        yield* Effect.promise(
          async () =>
            await queryClient.query(http.users.read.queryOptions({ input }))
        )
      ).toBe(7);
      const metadata = yield* Effect.promise(
        async () =>
          await queryClient.query(
            configureUtils(http.users.read, {
              metadata: {
                interceptors: [async ({ next }) => await next()],
              },
            }).metadataOptions({ input })
          )
      );
      expect(metadata.data).toBe(7);
      expect(Object.isFrozen(metadata)).toBe(true);
      expect(encoded).toBe(1);
    } finally {
      queryClient.clear();
    }
  })
);
