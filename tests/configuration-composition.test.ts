import { expect, it } from "@effect/vitest";
import { MutationObserver, QueryClient } from "@tanstack/query-core";
import { Effect, Layer, Schema, Stream } from "effect";
import { HttpServer } from "effect/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiTest,
} from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  configureUtils,
  defineUtilsPolicy,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
} from "#effect-api-query";

import { makeRpcTestClient } from "./fixtures/effect-rpc";

const around =
  (calls: string[], label: string) =>
  async <Data>({ next: execute }: { readonly next: () => Promise<Data> }) => {
    calls.push(`${label} start`);
    const result = await execute();
    calls.push(`${label} end`);
    return result;
  };

const expectedCalls = ["root start", "leaf start", "leaf end", "root end"];
const rpcGroup = RpcGroup.make(Rpc.make("users.get", { success: Schema.Int }));
const httpApi = HttpApi.make("configuration").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("get", "/users", { success: Schema.Int })
  )
);
const httpHandlers = HttpApiBuilder.group(httpApi, "users", (group) =>
  group.handle("get", () => Effect.succeed(42))
);

for (const order of ["root-first", "leaf-first"] as const) {
  it.effect(
    `composes RPC root and leaf configuration in scope order (${order})`,
    () =>
      Effect.gen(function* composition() {
        const client = yield* makeRpcTestClient(rpcGroup, {
          "users.get": () => Effect.succeed(42),
        });
        const base = createRpcQueryUtils(rpcGroup, {
          client,
          keyPrefix: ["composition"],
        });
        const calls: string[] = [];
        const root = defineUtilsPolicy<typeof base>()({
          query: {
            policy: { staleTime: 100 },
            interceptors: [around(calls, "root")],
          },
          mutation: {
            policy: { retry: 1 },
            interceptors: [around(calls, "root")],
          },
        });
        const leaf = defineUtilsPolicy<typeof base>()({
          scoped: {
            users: {
              scoped: {
                get: {
                  query: {
                    policy: { staleTime: 200 },
                    interceptors: [around(calls, "leaf")],
                  },
                  mutation: {
                    policy: { retry: 2 },
                    interceptors: [around(calls, "leaf")],
                  },
                },
              },
            },
          },
        });
        const configured =
          order === "root-first"
            ? configureUtils(configureUtils(base, root), leaf)
            : configureUtils(configureUtils(base, leaf), root);
        const queryClient = new QueryClient();
        const query = configured.users.get.queryOptions();
        expect({
          staleTime: queryClient.defaultQueryOptions(query).staleTime,
          original: queryClient.defaultQueryOptions(
            base.users.get.queryOptions()
          ).staleTime,
        }).toStrictEqual({ staleTime: 200, original: undefined });
        yield* Effect.promise(async () => await queryClient.query(query));
        expect(calls).toStrictEqual(expectedCalls);
        calls.length = 0;
        const mutationOptions = configured.users.get.mutationOptions();
        expect({
          retry: mutationOptions.retry,
          original: base.users.get.mutationOptions().retry,
        }).toStrictEqual({ retry: 2, original: undefined });
        yield* Effect.promise(
          async () =>
            await new MutationObserver(queryClient, mutationOptions).mutate()
        );
        expect(calls).toStrictEqual(expectedCalls);
        queryClient.clear();
      })
  );
}

for (const order of ["root-first", "leaf-first"] as const) {
  it.effect(
    `composes HTTP root and leaf configuration in scope order (${order})`,
    () =>
      Effect.gen(function* composition() {
        const client = yield* HttpApiTest.groups(httpApi, ["users"]).pipe(
          Effect.provide(Layer.mergeAll(httpHandlers, HttpServer.layerServices))
        );
        const base = createHttpApiQueryUtils(httpApi, {
          client,
          keyPrefix: ["composition"],
        });
        const calls: string[] = [];
        const root = defineUtilsPolicy<typeof base>()({
          query: {
            policy: { staleTime: 100 },
            interceptors: [around(calls, "root")],
          },
          mutation: {
            policy: { retry: 1 },
            interceptors: [around(calls, "root")],
          },
        });
        const leaf = defineUtilsPolicy<typeof base>()({
          scoped: {
            users: {
              scoped: {
                get: {
                  query: {
                    policy: { staleTime: 200 },
                    interceptors: [around(calls, "leaf")],
                  },
                  mutation: {
                    policy: { retry: 2 },
                    interceptors: [around(calls, "leaf")],
                  },
                },
              },
            },
          },
        });
        const configured =
          order === "root-first"
            ? configureUtils(configureUtils(base, root), leaf)
            : configureUtils(configureUtils(base, leaf), root);
        const queryClient = new QueryClient();
        const query = configured.users.get.queryOptions();
        expect({
          staleTime: queryClient.defaultQueryOptions(query).staleTime,
          original: queryClient.defaultQueryOptions(
            base.users.get.queryOptions()
          ).staleTime,
        }).toStrictEqual({ staleTime: 200, original: undefined });
        yield* Effect.promise(async () => await queryClient.query(query));
        expect(calls).toStrictEqual(expectedCalls);
        calls.length = 0;
        const mutationOptions = configured.users.get.mutationOptions();
        expect({
          retry: mutationOptions.retry,
          original: base.users.get.mutationOptions().retry,
        }).toStrictEqual({ retry: 2, original: undefined });
        yield* Effect.promise(
          async () =>
            await new MutationObserver(queryClient, mutationOptions).mutate()
        );
        expect(calls).toStrictEqual(expectedCalls);
        queryClient.clear();
      })
  );
}

it.effect(
  "snapshots configuration and lets later same-scope policies replace defaults",
  () =>
    Effect.gen(function* snapshots() {
      const client = yield* makeRpcTestClient(rpcGroup, {
        "users.get": () => Effect.succeed(42),
      });
      const base = createRpcQueryUtils(rpcGroup, {
        client,
        keyPrefix: ["snapshot"],
      });
      const calls: string[] = [];
      const settings = {
        query: {
          policy: { staleTime: 100, retry: 3 },
          interceptors: [around(calls, "original")],
        },
        mutation: { policy: { retry: 3 } },
      };
      const queryClient = new QueryClient();
      const first = configureUtils(base.users.get, settings);
      settings.query.policy.staleTime = 999;
      settings.query.interceptors.push(around(calls, "later"));
      settings.mutation.policy.retry = 999;
      expect({
        staleTime: queryClient.defaultQueryOptions(first.queryOptions())
          .staleTime,
        retry: first.mutationOptions().retry,
      }).toStrictEqual({ staleTime: 100, retry: 3 });
      const next = configureUtils(first, {
        query: { policy: { staleTime: 200, retry: 1 } },
      });
      expect({
        staleTime: queryClient.defaultQueryOptions(next.queryOptions())
          .staleTime,
        retry: next.queryOptions().retry,
        mutationRetry: next.mutationOptions().retry,
        originalRetry: first.queryOptions().retry,
      }).toStrictEqual({
        staleTime: 200,
        retry: 1,
        mutationRetry: 3,
        originalRetry: 3,
      });
      expect(
        yield* Effect.promise(
          async () => await queryClient.query(next.queryOptions())
        )
      ).toBe(42);
      expect(calls).toStrictEqual(["original start", "original end"]);
      queryClient.clear();
    })
);

it.effect(
  "clears inherited optional stream controls with explicit undefined",
  () =>
    Effect.gen(function* clearsStreamControls() {
      const streamGroup = RpcGroup.make(
        Rpc.make("events", { success: Schema.Int, stream: true })
      );
      const client = yield* makeRpcTestClient(streamGroup, {
        events: () => Stream.empty,
      });
      const base = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ["clear-controls"],
      });
      const first = configureUtils(base, {
        streamed: {
          policy: {
            maxChunks: 2,
            refetchMode: "append",
            publicationMaxWaitMs: 50,
          },
        },
      });
      const next = configureUtils(first.events, {
        streamed: {
          policy: { refetchMode: undefined, publicationMaxWaitMs: undefined },
        },
      });
      const expected = base.events.streamedKey({
        maxChunks: 2,
        refetchMode: "reset",
      });
      expect(next.streamedKey()).toStrictEqual(expected);
      expect(next.streamedOptions().queryKey).toStrictEqual(expected);
      expect(first.events.streamedKey()).not.toStrictEqual(expected);
      expect(
        first.events.streamedKey({
          refetchMode: undefined,
          publicationMaxWaitMs: undefined,
        })
      ).toStrictEqual(
        first.events.streamedOptions({
          refetchMode: undefined,
          publicationMaxWaitMs: undefined,
        }).queryKey
      );
    })
);

for (const composeRoot of [false, true]) {
  it.effect(
    `applies each mutation scope's callback policy (root compose: ${composeRoot})`,
    () =>
      Effect.gen(function* composesOwnedCallbacks() {
        const client = yield* makeRpcTestClient(rpcGroup, {
          "users.get": () => Effect.succeed(42),
        });
        const calls: string[] = [];
        const base = createRpcQueryUtils(rpcGroup, {
          client,
          keyPrefix: ["scope-callbacks"],
        });
        const policy = defineUtilsPolicy<typeof base>()({
          mutation: {
            callbacks: composeRoot ? "compose" : "replace",
            policy: {
              onSuccess: () => {
                calls.push("root");
              },
            },
          },
          scoped: {
            users: {
              scoped: {
                get: {
                  mutation: {
                    callbacks: composeRoot ? "replace" : "compose",
                    policy: {
                      onSuccess: () => {
                        calls.push("leaf");
                      },
                    },
                  },
                },
              },
            },
          },
        });
        const configured = configureUtils(base, policy);
        const queryClient = new QueryClient();
        try {
          const mutation = new MutationObserver(
            queryClient,
            configured.users.get.mutationOptions(
              composeRoot
                ? {}
                : {
                    onSuccess: () => {
                      calls.push("local");
                    },
                  }
            )
          );
          yield* Effect.promise(async () => await mutation.mutate());
          expect(calls).toStrictEqual(
            composeRoot ? ["root", "leaf"] : ["leaf", "local"]
          );
        } finally {
          queryClient.clear();
        }
      })
  );
}

for (const replaceCallback of [false, true]) {
  it.effect(
    `merges repeated mutation settings at one scope (replace callback: ${replaceCallback})`,
    () =>
      Effect.gen(function* mergesScopeCallbacks() {
        const client = yield* makeRpcTestClient(rpcGroup, {
          "users.get": () => Effect.succeed(42),
        });
        const base = createRpcQueryUtils(rpcGroup, {
          client,
          keyPrefix: ["same-scope-callbacks"],
        });
        const calls: string[] = [];
        const first = configureUtils(base.users.get, {
          mutation: {
            callbacks: replaceCallback ? "compose" : "replace",
            policy: {
              onSuccess: () => {
                calls.push("first");
              },
            },
          },
        });
        const second = replaceCallback
          ? configureUtils(first, {
              mutation: {
                callbacks: "replace",
                policy: {
                  onSuccess: () => {
                    calls.push("second");
                  },
                },
              },
            })
          : configureUtils(first, {
              mutation: { callbacks: "compose", policy: { retry: 1 } },
            });
        const queryClient = new QueryClient();
        try {
          yield* Effect.promise(
            async () =>
              await new MutationObserver(
                queryClient,
                second.mutationOptions()
              ).mutate()
          );
          expect(calls).toStrictEqual(replaceCallback ? ["second"] : ["first"]);
          calls.length = 0;
          yield* Effect.promise(
            async () =>
              await new MutationObserver(
                queryClient,
                second.mutationOptions({
                  onSuccess: () => {
                    calls.push("local");
                  },
                })
              ).mutate()
          );
          expect(calls).toStrictEqual(
            replaceCallback ? ["local"] : ["first", "local"]
          );
        } finally {
          queryClient.clear();
        }
      })
  );
}

for (const overrideScope of [false, true]) {
  it.effect(
    `clears composed callbacks through explicit JavaScript overrides (scope: ${overrideScope})`,
    () =>
      Effect.gen(function* clearsComposedCallbacks() {
        const client = yield* makeRpcTestClient(rpcGroup, {
          "users.get": () => Effect.succeed(42),
        });
        const calls: string[] = [];
        const first = configureUtils(
          createRpcQueryUtils(rpcGroup, {
            client,
            keyPrefix: ["clear-callbacks"],
          }),
          {
            mutation: {
              callbacks: "compose",
              policy: {
                onSuccess: () => {
                  calls.push("root");
                },
              },
            },
          }
        );
        const override = {
          onSuccess: () => {
            calls.push("replacement");
          },
        };
        Object.defineProperty(override, "onSuccess", { value: undefined });
        const leaf = overrideScope
          ? configureUtils(first.users.get, { mutation: { policy: override } })
          : first.users.get;
        const queryClient = new QueryClient();
        try {
          const options = leaf.mutationOptions(overrideScope ? {} : override);
          yield* Effect.promise(
            async () =>
              await new MutationObserver(queryClient, options).mutate()
          );
          expect(calls).toStrictEqual([]);
        } finally {
          queryClient.clear();
        }
      })
  );
}

it.effect("retains callback-only scopes for later mutation policies", () =>
  Effect.gen(function* retainsCallbackMode() {
    const client = yield* makeRpcTestClient(rpcGroup, {
      "users.get": () => Effect.succeed(42),
    });
    const first = configureUtils(
      createRpcQueryUtils(rpcGroup, {
        client,
        keyPrefix: ["callback-only-scope"],
      }),
      {
        scoped: {
          users: { scoped: { get: { mutation: { callbacks: "compose" } } } },
        },
      }
    );
    const calls: string[] = [];
    const second = configureUtils(first, {
      scoped: {
        users: {
          scoped: {
            get: {
              mutation: {
                policy: {
                  onSuccess: () => {
                    calls.push("shared");
                  },
                },
              },
            },
          },
        },
      },
    });
    const queryClient = new QueryClient();
    try {
      yield* Effect.promise(
        async () =>
          await new MutationObserver(
            queryClient,
            second.users.get.mutationOptions({
              onSuccess: () => {
                calls.push("local");
              },
            })
          ).mutate()
      );
      expect(calls).toStrictEqual(["shared", "local"]);
    } finally {
      queryClient.clear();
    }
  })
);

it.effect("preserves native failures from assembled mutation callbacks", () =>
  Effect.gen(function* callbackFailures() {
    const client = yield* makeRpcTestClient(rpcGroup, {
      "users.get": () => Effect.succeed(42),
    });
    const base = createRpcQueryUtils(rpcGroup, {
      client,
      keyPrefix: ["failure-policy"],
    });
    const calls: string[] = [];
    const failure = new Error("application callback failed");
    const policy = defineUtilsPolicy<typeof base.users.get>()({
      mutation: {
        callbacks: "compose",
        interceptors: [around(calls, "required")],
        policy: {
          onSuccess: () => {
            calls.push("shared success");
            throw failure;
          },
        },
      },
    });
    const leaf = configureUtils(base.users.get, policy);
    const queryClient = new QueryClient();
    try {
      const mutation = new MutationObserver(
        queryClient,
        leaf.mutationOptions({
          onMutate: () => {
            calls.push("local prepare");
            return { previous: 7 };
          },
          onSuccess: () => {
            calls.push("local success");
          },
          onError: (error, _input, optimistic) => {
            expect(error).toBe(failure);
            expect(optimistic?.previous).toBe(7);
            calls.push("local error");
          },
          onSettled: () => {
            calls.push("local settled");
          },
        })
      );
      yield* Effect.promise(async () => {
        await expect(mutation.mutate()).rejects.toBe(failure);
      });
      expect(calls).toStrictEqual([
        "local prepare",
        "required start",
        "required end",
        "shared success",
        "local error",
        "local settled",
      ]);
      expect(mutation.getCurrentResult().status).toBe("error");
    } finally {
      queryClient.clear();
    }
  })
);

it.effect("applies assembled tree, branch, leaf and call-site defaults", () =>
  Effect.gen(function* assembledOptions() {
    const client = yield* makeRpcTestClient(rpcGroup, {
      "users.get": () => Effect.succeed(42),
    });
    const base = createRpcQueryUtils(rpcGroup, {
      client,
      keyPrefix: ["assembled-options"],
    });
    const calls: string[] = [];
    const policy = defineUtilsPolicy<typeof base>()({
      query: {
        policy: { staleTime: 100 },
        interceptors: [around(calls, "tree")],
      },
      scoped: {
        users: {
          query: {
            policy: { staleTime: 200, gcTime: 600 },
            interceptors: [around(calls, "branch")],
          },
          scoped: {
            get: {
              query: {
                policy: { staleTime: 300 },
                interceptors: [around(calls, "leaf")],
              },
            },
          },
        },
      },
    });
    const configured = configureUtils(base, policy);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 50, retry: false } },
    });
    try {
      const options = configured.users.get.queryOptions({
        staleTime: 0,
        initialData: 5,
        select: (value) => `value ${value}`,
      });
      const final = queryClient.defaultQueryOptions(options);
      expect({
        staleTime: final.staleTime,
        gcTime: final.gcTime,
        retry: final.retry,
        initialData: final.initialData,
      }).toStrictEqual({
        staleTime: 0,
        gcTime: 600,
        retry: false,
        initialData: 5,
      });
      expect(options.queryKey).toStrictEqual(base.users.get.queryKey());
      expect(
        yield* Effect.promise(async () => await queryClient.query(options))
      ).toBe("value 42");
      expect(queryClient.getQueryData(options.queryKey)).toBe(42);
      expect(calls).toStrictEqual([
        "tree start",
        "branch start",
        "leaf start",
        "leaf end",
        "branch end",
        "tree end",
      ]);
    } finally {
      queryClient.clear();
    }
  })
);

it.effect("keeps local onMutate failures ahead of assembled execution", () =>
  Effect.gen(function* localPreparationFailure() {
    const client = yield* makeRpcTestClient(rpcGroup, {
      "users.get": () => Effect.succeed(42),
    });
    const base = createRpcQueryUtils(rpcGroup, {
      client,
      keyPrefix: ["prepare-failure"],
    });
    const calls: string[] = [];
    const policy = defineUtilsPolicy<typeof base.users.get>()({
      mutation: {
        callbacks: "compose",
        interceptors: [around(calls, "execution")],
        policy: {
          onSuccess: () => {
            calls.push("shared success");
          },
        },
      },
    });
    const failure = new Error("optimistic preparation failed");
    const queryClient = new QueryClient();
    try {
      const mutation = new MutationObserver(
        queryClient,
        configureUtils(base.users.get, policy).mutationOptions({
          onMutate: () => {
            calls.push("prepare");
            throw failure;
          },
          onError: (_error, _input, optimistic) => {
            expect(optimistic).toBeUndefined();
            calls.push("error");
          },
          onSettled: () => {
            calls.push("settled");
          },
        })
      );
      yield* Effect.promise(async () => {
        await expect(mutation.mutate()).rejects.toBe(failure);
      });
      expect(calls).toStrictEqual(["prepare", "error", "settled"]);
    } finally {
      queryClient.clear();
    }
  })
);
