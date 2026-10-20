import { describe, expect, it, vi } from "@effect/vitest";
import { QueryClient, QueryObserver, skipToken } from "@tanstack/query-core";
import {
  Cause,
  Deferred,
  Effect,
  Equal,
  Exit,
  Predicate,
  Schema,
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
import type { RpcClient } from "effect/rpc";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  EffectHttpApiQueryError,
  EffectRpcQueryConfigError,
  EffectRpcQueryEmptyStreamError,
  EffectRpcQueryError,
  isEffectHttpApiQueryError,
  isEffectRpcQueryError,
} from "#effect-api-query";
import type { RunPromiseExit } from "#effect-api-query";

import { captureFailure } from "./fixtures/async";
import { makeRpcTestClient } from "./fixtures/effect-rpc";

describe("createRpcQueryUtils streaming execution", () => {
  it.effect(
    "accumulates stream elements and publishes the latest live value",
    () =>
      Effect.gen(function* accumulateAndPublishLive() {
        const Watch = Rpc.make("events.watch", {
          payload: {
            channel: Schema.String,
            locale: Schema.String.pipe(
              Schema.optionalKey,
              Schema.withConstructorDefault(Effect.succeed("en"))
            ),
          },
          success: Schema.String,
          stream: true,
        });
        const streamGroup = RpcGroup.make(Watch);
        const client = yield* makeRpcTestClient(streamGroup, {
          "events.watch": ({
            channel,
            locale = "en",
          }: {
            readonly channel: string;
            readonly locale?: string;
          }) =>
            Stream.make(
              `${channel}:${locale}:first`,
              `${channel}:${locale}:second`
            ),
        });
        const queryClient = new QueryClient();
        const utils = createRpcQueryUtils(streamGroup, {
          client,
          keyPrefix: ["app"] as const,
        });

        const streamed = yield* Effect.promise(
          async () =>
            await queryClient.query(
              utils.events.watch.streamedOptions({ input: { channel: "news" } })
            )
        );
        const live = yield* Effect.promise(
          async () =>
            await queryClient.query(
              utils.events.watch.liveOptions({ input: { channel: "news" } })
            )
        );

        expect(streamed).toStrictEqual(["news:en:first", "news:en:second"]);
        expect(live).toBe("news:en:second");
        expect(
          utils.events.watch.streamedKey({ channel: "news" })
        ).toStrictEqual(
          utils.events.watch.streamedKey({ channel: "news", locale: "en" })
        );
        expect(
          utils.events.watch.streamedKey({ channel: "news" })
        ).not.toStrictEqual(utils.events.watch.liveKey({ channel: "news" }));
        expect(
          Object.isFrozen(utils.events.watch.streamedKey({ channel: "news" }))
        ).toBe(true);
      })
  );

  it.effect(
    "retains only the newest accumulated values after each emission",
    () =>
      Effect.gen(function* retainNewestValues() {
        const Watch = Rpc.make("events.watch", {
          success: Schema.Finite,
          stream: true,
        });
        const group = RpcGroup.make(Watch);
        const client = yield* makeRpcTestClient(group, {
          "events.watch": () => Stream.make(1, 2, 3, 4),
        });
        const utils = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["bounded"],
        });
        const queryClient = new QueryClient();
        const options = utils.events.watch.streamedOptions({ maxChunks: 2 });
        const snapshots: unknown[] = [];
        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
          if (event.type === "updated" && event.action.type === "success") {
            snapshots.push(queryClient.getQueryData(options.queryKey));
          }
        });
        try {
          expect(
            yield* Effect.promise(async () => await queryClient.query(options))
          ).toStrictEqual([3, 4]);
          expect(snapshots.slice(0, 4)).toStrictEqual([
            [1],
            [1, 2],
            [2, 3],
            [3, 4],
          ]);
          expect(options).not.toHaveProperty("maxChunks");
        } finally {
          unsubscribe();
          queryClient.clear();
        }
      })
  );

  describe.each([
    {
      refetchMode: "reset",
      during: [[1], [1, 2], [2, 3], [2, 3]],
      start: undefined,
    },
    {
      refetchMode: "append",
      during: [
        [9, 1],
        [1, 2],
        [2, 3],
        [2, 3],
      ],
      start: [-2, -1, 0, 9],
    },
    {
      refetchMode: "replace",
      during: [
        [2, 3],
        [2, 3],
      ],
      start: [-2, -1, 0, 9],
    },
  ] as const)(
    "bounds $refetchMode refetches through QueryClient",
    ({ refetchMode, during, start }) => {
      it.effect("bounds cached history throughout refetch", () =>
        Effect.gen(function* boundRefetchHistory() {
          const Watch = Rpc.make("events.watch", {
            success: Schema.Finite,
            stream: true,
          });
          const group = RpcGroup.make(Watch);
          const queryClient = new QueryClient();
          const snapshots: unknown[] = [];
          let key: readonly unknown[] = [];
          const emitRefetchValues = async function* emitRefetchValues() {
            await Promise.resolve();
            expect(queryClient.getQueryData(key)).toStrictEqual(start);
            for (const value of [1, 2, 3]) {
              yield value;
            }
          };
          const client = yield* makeRpcTestClient(group, {
            "events.watch": () =>
              Stream.fromAsyncIterable(
                emitRefetchValues(),
                (cause) => cause
              ).pipe(Stream.orDie),
          });
          const utils = createRpcQueryUtils(group, {
            client,
            keyPrefix: ["bounded"],
          });
          const options = utils.events.watch.streamedOptions({
            maxChunks: 2,
            refetchMode,
          });
          key = options.queryKey;
          queryClient.setQueryData(options.queryKey, [-2, -1, 0, 9]);
          const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
            if (event.type === "updated" && event.action.type === "success") {
              snapshots.push(queryClient.getQueryData(options.queryKey));
            }
          });
          try {
            expect(
              yield* Effect.promise(
                async () => await queryClient.query(options)
              )
            ).toStrictEqual([2, 3]);
            expect(snapshots).toStrictEqual(during);
            expect(queryClient.getQueryData(options.queryKey)).toStrictEqual([
              2, 3,
            ]);
          } finally {
            unsubscribe();
            queryClient.clear();
          }
        })
      );
    }
  );

  describe.each([
    { maxChunks: 1, expected: [4] },
    { maxChunks: Number.MAX_SAFE_INTEGER, expected: [1, 2, 3, 4] },
  ])("accepts the boundary value $maxChunks", ({ maxChunks, expected }) => {
    it.effect("accepts the retention boundary", () =>
      Effect.gen(function* acceptRetentionBoundary() {
        const Watch = Rpc.make("events.watch", {
          success: Schema.Finite,
          stream: true,
        });
        const group = RpcGroup.make(Watch);
        const client = yield* makeRpcTestClient(group, {
          "events.watch": () => Stream.make(1, 2, 3, 4),
        });
        const utils = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["bounded"],
        });
        const queryClient = new QueryClient();
        try {
          const options = utils.events.watch.streamedOptions({ maxChunks });
          expect(
            yield* Effect.promise(async () => await queryClient.query(options))
          ).toStrictEqual(expected);
        } finally {
          queryClient.clear();
        }
      })
    );
  });

  it.effect("resets bounded accumulation independently of initial data", () =>
    Effect.gen(function* resetSeededHistory() {
      let values = [1];
      const Watch = Rpc.make("events.watch", {
        success: Schema.Finite,
        stream: true,
      });
      const group = RpcGroup.make(Watch);
      const client = yield* makeRpcTestClient(group, {
        "events.watch": () => Stream.fromIterable(values),
      });
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ["bounded"],
      });
      const options = utils.events.watch.streamedOptions({
        initialData: [9],
        maxChunks: 2,
      });
      const queryClient = new QueryClient();
      try {
        expect(
          yield* Effect.promise(async () => await queryClient.query(options))
        ).toStrictEqual([9, 1]);
        values = [2];
        expect(
          yield* Effect.promise(async () => await queryClient.query(options))
        ).toStrictEqual([2]);
        values = [];
        expect(
          yield* Effect.promise(async () => await queryClient.query(options))
        ).toStrictEqual([]);
        expect(queryClient.getQueryData(options.queryKey)).toStrictEqual([]);
      } finally {
        queryClient.clear();
      }
    })
  );

  it.effect(
    "rejects invalid retention bounds synchronously, including skipped queries",
    () =>
      Effect.gen(function* rejectInvalidRetention() {
        const Watch = Rpc.make("events.watch", {
          payload: { channel: Schema.String },
          success: Schema.Finite,
          stream: true,
        });
        const group = RpcGroup.make(Watch);
        const client = yield* makeRpcTestClient(group, {
          "events.watch": () => Stream.make(1),
        });
        const utils = createRpcQueryUtils(group, {
          client,
          keyPrefix: ["bounded"],
        });
        for (const maxChunks of [
          0,
          -1,
          1.5,
          Number.NaN,
          Infinity,
          -Infinity,
          Number.MAX_SAFE_INTEGER + 1,
        ]) {
          for (const input of [{ channel: "news" }, skipToken] as const) {
            const buildOptions = () =>
              utils.events.watch.streamedOptions({ input, maxChunks });
            expect(buildOptions).toThrow(EffectRpcQueryConfigError);
            expect(buildOptions).toThrow(
              expect.objectContaining({
                code: "InvalidMaxChunks",
                rpcTag: "events.watch",
              })
            );
          }
        }
        const skipped = utils.events.watch.streamedOptions({
          input: skipToken,
          maxChunks: 1,
        });
        expect(skipped.queryFn).toBe(skipToken);
        expect(skipped).not.toHaveProperty("maxChunks");
        expect(() =>
          utils.events.watch.streamedOptions({
            input: { channel: "news" },
            maxChunks: Number.MAX_SAFE_INTEGER,
          })
        ).not.toThrow();
      })
  );

  it.effect(
    "fails an empty live stream with its documented package error",
    () =>
      Effect.gen(function* rejectEmptyLiveStream() {
        const Empty = Rpc.make("events.empty", {
          success: Schema.String,
          stream: true,
        });
        const streamGroup = RpcGroup.make(Empty);
        const client = yield* makeRpcTestClient(streamGroup, {
          "events.empty": () => Stream.empty,
        });
        const utils = createRpcQueryUtils(streamGroup, {
          client,
          keyPrefix: ["app"] as const,
        });

        const error = yield* Effect.promise(
          async () =>
            await captureFailure(
              new QueryClient({
                defaultOptions: { queries: { retry: false } },
              }).query(utils.events.empty.liveOptions())
            )
        );

        expect(error).toStrictEqual(
          expect.objectContaining({
            _tag: "EffectRpcQueryEmptyStreamError",
            rpcTag: "events.empty",
          })
        );
        expect(error).toBeInstanceOf(EffectRpcQueryEmptyStreamError);
      })
  );

  it.effect("supports reset, append, and replace refetch modes", () =>
    Effect.gen(function* refetchAcrossPolicies() {
      let run = 0;
      const Watch = Rpc.make("events.watch", {
        success: Schema.String,
        stream: true,
      });
      const streamGroup = RpcGroup.make(Watch);
      const client = yield* makeRpcTestClient(streamGroup, {
        "events.watch": () => {
          run += 1;
          return Stream.make(
            `run-${String(run)}-first`,
            `run-${String(run)}-second`
          );
        },
      });
      const queryClient = new QueryClient();
      const utils = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ["app"] as const,
      });

      const fetch = async (refetchMode: "append" | "replace" | "reset") =>
        await queryClient.query(
          utils.events.watch.streamedOptions({ refetchMode })
        );

      const results = {
        initialReset: yield* Effect.promise(async () => await fetch("reset")),
        firstAppend: yield* Effect.promise(async () => await fetch("append")),
        secondAppend: yield* Effect.promise(async () => await fetch("append")),
        firstReplace: yield* Effect.promise(async () => await fetch("replace")),
        secondReplace: yield* Effect.promise(
          async () => await fetch("replace")
        ),
        repeatedReset: yield* Effect.promise(async () => await fetch("reset")),
      };
      expect(results).toStrictEqual({
        initialReset: ["run-1-first", "run-1-second"],
        firstAppend: ["run-2-first", "run-2-second"],
        secondAppend: [
          "run-2-first",
          "run-2-second",
          "run-3-first",
          "run-3-second",
        ],
        firstReplace: ["run-4-first", "run-4-second"],
        secondReplace: ["run-5-first", "run-5-second"],
        repeatedReset: ["run-6-first", "run-6-second"],
      });
    })
  );

  it.effect("preserves stream, RPC, and defect Causes", () =>
    Effect.gen(function* preserveStreamCauses() {
      const Declared = Rpc.make("events.declared", {
        success: Schema.String,
        error: Schema.Literal("stream-failure"),
        stream: true,
      }).setError(Schema.Literal("rpc-failure"));
      const StreamFailure = Rpc.make("events.stream-failure", {
        success: Schema.String,
        error: Schema.Literal("stream-failure"),
        stream: true,
      });
      const Defect = Rpc.make("events.defect", {
        success: Schema.String,
        stream: true,
      });
      const streamGroup = RpcGroup.make(Declared, StreamFailure, Defect);
      const defect = new Error("stream defect");
      const client = yield* makeRpcTestClient(streamGroup, {
        "events.declared": () => Stream.fail("rpc-failure" as const),
        "events.defect": () => Stream.die(defect),
        "events.stream-failure": () => Stream.fail("stream-failure" as const),
      });
      const utils = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ["app"] as const,
      });
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      const cases = [
        {
          direct: yield* Effect.exit(
            // oxlint-disable-next-line unicorn/no-useless-undefined
            Stream.runCollect(client("events.declared", undefined))
          ),
          fetch: async () =>
            await queryClient.query(utils.events.declared.streamedOptions()),
          operation: "streamed",
          tag: "events.declared",
        },
        {
          direct: yield* Effect.exit(
            // oxlint-disable-next-line unicorn/no-useless-undefined
            Stream.runCollect(client("events.stream-failure", undefined))
          ),
          fetch: async () =>
            await queryClient.query(
              utils.events["stream-failure"].streamedOptions()
            ),
          operation: "streamed",
          tag: "events.stream-failure",
        },
        {
          direct: yield* Effect.exit(
            // oxlint-disable-next-line unicorn/no-useless-undefined
            Stream.runCollect(client("events.defect", undefined))
          ),
          fetch: async () =>
            await queryClient.query(utils.events.defect.liveOptions()),
          operation: "live",
          tag: "events.defect",
        },
      ] as const;

      for (const { direct, fetch, operation, tag } of cases) {
        if (Exit.isSuccess(direct)) {
          throw new Error(`Expected ${tag} to fail`);
        }
        const error = yield* Effect.promise(
          async () => await captureFailure(fetch())
        );

        expect(error).toBeInstanceOf(EffectRpcQueryError);
        expect(error).toMatchObject({ operation, rpcTag: tag });
        if (!isEffectRpcQueryError(error)) {
          throw new Error("Expected RPC execution error");
        }
        expect(Equal.equals(error.cause, direct.cause)).toBe(true);
      }
    })
  );

  describe.each(["live", "streamed"] as const)(
    "preserves independent interruption and mixed Causes from an official client in %s queries",
    (operation) => {
      it.effect("preserves complete interruption Causes", () =>
        Effect.gen(function* preserveInterruptionCauses() {
          const Watch = Rpc.make("events.watch", {
            success: Schema.String,
            stream: true,
          });
          const streamGroup = RpcGroup.make(Watch);
          const defect = new Error("stream defect");
          const causes = [
            Cause.interrupt(42),
            Cause.combine(Cause.interrupt(42), Cause.die(defect)),
          ] as const;
          let [currentCause] = causes;
          const client = yield* makeRpcTestClient(streamGroup, {
            "events.watch": () => Stream.failCause(currentCause),
          });
          const utils = createRpcQueryUtils(streamGroup, {
            client,
            keyPrefix: ["interrupt", operation],
          });
          const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
          });
          try {
            for (const cause of causes) {
              currentCause = cause;
              const direct = yield* Effect.exit(
                // oxlint-disable-next-line unicorn/no-useless-undefined
                Stream.runCollect(client("events.watch", undefined))
              );
              if (Exit.isSuccess(direct)) {
                throw new TypeError("Expected a failed client stream");
              }
              const error = yield* Effect.promise(
                async () =>
                  await captureFailure(
                    operation === "live"
                      ? queryClient.query(utils.events.watch.liveOptions())
                      : queryClient.query(utils.events.watch.streamedOptions())
                  )
              );
              expect(error).toBeInstanceOf(EffectRpcQueryError);
              expect(error).toMatchObject({
                rpcTag: "events.watch",
                operation,
              });
              if (!isEffectRpcQueryError(error)) {
                throw new TypeError("Expected an RPC execution error");
              }
              expect(error.cause).toStrictEqual(direct.cause);
            }
          } finally {
            queryClient.clear();
          }
        })
      );
    }
  );

  describe.each(["ensuring", "acquireRelease"] as const)(
    "client-side %s finalization",
    (finalizer) => {
      describe.each(["completion", "failure"] as const)(
        "after stream %s",
        (ending) => {
          it.each(["live", "streamed"] as const)(
            "preserves complete stream and finalizer Causes in %s queries",
            async (operation) => {
              const group = RpcGroup.make(
                Rpc.make("watch", {
                  success: Schema.Int,
                  error: Schema.String,
                  stream: true,
                })
              );
              const cleanupCause = Cause.combine(
                Cause.die(new Error("first release failed")),
                Cause.die(new Error("second release failed"))
              );
              const streamCause = Cause.combine(
                Cause.fail("stream failed"),
                Cause.die(new Error("stream defect"))
              );
              const values =
                ending === "completion"
                  ? Stream.succeed(1)
                  : Stream.succeed(1).pipe(
                      Stream.concat(Stream.failCause(streamCause))
                    );
              const release = Effect.failCause(cleanupCause);
              const source =
                finalizer === "ensuring"
                  ? values.pipe(Stream.ensuring(release))
                  : Stream.unwrap(
                      Effect.acquireRelease(Effect.void, () => release).pipe(
                        Effect.as(values)
                      )
                    );
              /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
              const client = (() => source) as RpcClient.RpcClient.Flat<
                RpcGroup.Rpcs<typeof group>
              >;
              /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
              const rpc = createRpcQueryUtils(group, {
                client,
                keyPrefix: [
                  "client-finalization",
                  finalizer,
                  operation,
                  ending,
                ],
              });
              const queryClient = new QueryClient({
                defaultOptions: { queries: { retry: false } },
              });
              try {
                const error = await captureFailure(
                  operation === "live"
                    ? queryClient.query(rpc.watch.liveOptions())
                    : queryClient.query(rpc.watch.streamedOptions())
                );
                expect(error).toBeInstanceOf(EffectRpcQueryError);
                expect(error).toMatchObject({ rpcTag: "watch", operation });
                if (!isEffectRpcQueryError(error)) {
                  throw new TypeError("Expected an RPC execution error");
                }
                expect(
                  Equal.equals(
                    error.cause,
                    ending === "completion"
                      ? cleanupCause
                      : Cause.combine(streamCause, cleanupCause)
                  )
                ).toBe(true);
              } finally {
                queryClient.clear();
              }
            }
          );
        }
      );

      it.each(["live", "streamed"] as const)(
        "preserves interruption and cleanup defects when cancelling a pending %s pull",
        async (operation) => {
          const group = RpcGroup.make(
            Rpc.make("watch", { success: Schema.Int, stream: true })
          );
          const entered = Deferred.makeUnsafe<boolean>();
          const cleanupCause = Cause.combine(
            Cause.die(new Error("first release failed")),
            Cause.die(new Error("second release failed"))
          );
          let interruption: Cause.Cause<never> | undefined;
          const values = Stream.fromEffect(
            Deferred.succeed(entered, true).pipe(
              Effect.andThen(Effect.never),
              Effect.onError((cause) =>
                Effect.sync(() => {
                  interruption = cause;
                })
              )
            )
          );
          const release = Effect.failCause(cleanupCause);
          const source =
            finalizer === "ensuring"
              ? values.pipe(Stream.ensuring(release))
              : Stream.unwrap(
                  Effect.acquireRelease(Effect.void, () => release).pipe(
                    Effect.as(values)
                  )
                );
          /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
          const client = (() => source) as RpcClient.RpcClient.Flat<
            RpcGroup.Rpcs<typeof group>
          >;
          /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
          const rpc = createRpcQueryUtils(group, {
            client,
            keyPrefix: ["pending-pull-cleanup", finalizer, operation],
          });
          const options =
            operation === "live"
              ? rpc.watch.liveOptions()
              : rpc.watch.streamedOptions();
          const { queryFn } = options;
          if (!Predicate.isFunction(queryFn)) {
            throw new TypeError("Expected a callable stream query function");
          }
          const queryClient = new QueryClient();
          const controller = new AbortController();
          const pending = captureFailure(
            Promise.resolve(
              queryFn({
                client: queryClient,
                queryKey: options.queryKey,
                signal: controller.signal,
                meta: undefined,
              })
            )
          );
          try {
            await Effect.runPromise(Deferred.await(entered));
            controller.abort();
            const error = await pending;
            expect(error).toMatchObject({
              _tag: "EffectRpcQueryError",
              rpcTag: "watch",
              operation,
            });
            if (!isEffectRpcQueryError(error) || interruption === undefined) {
              throw new TypeError(
                "Expected an interrupted RPC execution error"
              );
            }
            expect(Cause.hasInterruptsOnly(interruption)).toBe(true);
            expect(
              Equal.equals(
                error.cause,
                Cause.combine(interruption, cleanupCause)
              )
            ).toBe(true);
          } finally {
            controller.abort();
            await pending;
            queryClient.clear();
          }
        }
      );
    }
  );

  describe.each(["ensuring", "acquireRelease"] as const)(
    "HTTP client-side %s finalization",
    (finalizer) => {
      it.effect("preserves complete finalizer Causes", () =>
        Effect.gen(function* preserveHttpFinalizerCause() {
          const api = HttpApi.make("client-finalization").add(
            HttpApiGroup.make("events").add(
              HttpApiEndpoint.get("watch", "/watch", {
                success: HttpApiSchema.StreamSse({ data: Schema.Int }),
              })
            )
          );
          const cause = Cause.combine(
            Cause.die(new Error("first release failed")),
            Cause.die(new Error("second release failed"))
          );
          const release = Effect.failCause(cause);
          const client = yield* HttpApiClient.makeWith(api, {
            baseUrl: "https://example.test",
            httpClient: HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response("data: 1\n\n", {
                    headers: { "content-type": "text/event-stream" },
                  })
                )
              )
            ),
            /* oxlint-disable effecttsgo/any-unknown-in-error-context */
            transformResponse: (effect) =>
              effect.pipe(
                Effect.map((response) => {
                  if (!Stream.isStream(response)) {
                    return response;
                  }
                  return finalizer === "ensuring"
                    ? response.pipe(Stream.ensuring(release))
                    : Stream.unwrap(
                        Effect.acquireRelease(Effect.void, () => release).pipe(
                          Effect.as(response)
                        )
                      );
                })
              ),
            /* oxlint-enable effecttsgo/any-unknown-in-error-context */
          });
          const http = createHttpApiQueryUtils(api, {
            client,
            keyPrefix: ["http-client-finalization", finalizer],
          });
          const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
          });
          try {
            const error = yield* Effect.promise(
              async () =>
                await captureFailure(
                  queryClient.query(http.events.watch.streamedOptions())
                )
            );
            expect(error).toBeInstanceOf(EffectHttpApiQueryError);
            expect(error).toMatchObject({
              apiId: "client-finalization",
              groupId: "events",
              endpoint: "watch",
              operation: "streamed",
            });
            if (!isEffectHttpApiQueryError(error)) {
              throw new TypeError("Expected an HTTP execution error");
            }
            expect(Equal.equals(error.cause, cause)).toBe(true);
          } finally {
            queryClient.clear();
          }
        })
      );
    }
  );

  it.effect("finalizes a stream after normal completion", () =>
    Effect.gen(function* finalizeCompletedStream() {
      const Watch = Rpc.make("events.watch", {
        success: Schema.String,
        stream: true,
      });
      const streamGroup = RpcGroup.make(Watch);
      const finalized = yield* Deferred.make<boolean>();
      const source = Stream.make("first", "second").pipe(
        Stream.ensuring(Deferred.succeed(finalized, true).pipe(Effect.asVoid))
      );
      const client = yield* makeRpcTestClient(streamGroup, {
        "events.watch": () => source,
      });
      const utils = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ["app"] as const,
      });

      const result = yield* Effect.promise(
        async () =>
          await new QueryClient().query(utils.events.watch.streamedOptions())
      );

      expect(result).toStrictEqual(["first", "second"]);
      yield* Deferred.await(finalized);
    })
  );

  it("interrupts and finalizes a stream when Query Core cancels it", async () => {
    const Watch = Rpc.make("events.watch", {
      success: Schema.String,
      stream: true,
    });
    const streamGroup = RpcGroup.make(Watch);
    const waiting = Deferred.makeUnsafe<boolean>();
    const interrupted = Deferred.makeUnsafe<boolean>();
    const finalized = Deferred.makeUnsafe<boolean>();
    const source = Stream.make("ready").pipe(
      Stream.concat(
        Stream.fromEffect(
          Deferred.succeed(waiting, true).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Deferred.succeed(interrupted, true).pipe(Effect.asVoid)
            )
          )
        )
      ),
      Stream.ensuring(Deferred.succeed(finalized, true).pipe(Effect.asVoid))
    );
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    const client = (() => source) as RpcClient.RpcClient.Flat<
      RpcGroup.Rpcs<typeof streamGroup>
    >;
    /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    const queryClient = new QueryClient();
    const utils = createRpcQueryUtils(streamGroup, {
      client,
      keyPrefix: ["app"] as const,
    });
    const options = utils.events.watch.streamedOptions();

    const query = captureFailure(queryClient.query(options));
    await Effect.runPromise(Deferred.await(waiting));
    await queryClient.cancelQueries({ queryKey: options.queryKey });
    await Effect.runPromise(
      Deferred.await(interrupted).pipe(
        Effect.andThen(Deferred.await(finalized))
      )
    );

    expect(Deferred.isDoneUnsafe(interrupted)).toBe(true);
    expect(Deferred.isDoneUnsafe(finalized)).toBe(true);
    await expect(query).resolves.toStrictEqual(["ready"]);
  });

  it("detaches the abort listener when iterator closure fails", async () => {
    const Watch = Rpc.make("events.watch", {
      success: Schema.String,
      stream: true,
    });
    const streamGroup = RpcGroup.make(Watch);
    const closeError = new Error("iterator closure failed");
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]: () => ({
        next: async () =>
          await Promise.resolve({ done: false, value: "ready" }),
        return: async () => await Promise.reject(closeError),
      }),
    };
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    const runPromiseExit: RunPromiseExit = async () =>
      (await Promise.resolve(Exit.succeed(source))) as never;
    /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
    const utils = createRpcQueryUtils(streamGroup, {
      client: () => {
        throw new Error("The custom runner must supply the stream iterator");
      },
      keyPrefix: ["app"] as const,
      runPromiseExit,
    });
    const options = utils.events.watch.streamedOptions();
    const { queryFn } = options;
    if (!Predicate.isFunction(queryFn)) {
      throw new TypeError("Expected a callable stream query function");
    }
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(
      controller.signal,
      "removeEventListener"
    );
    controller.abort();

    await expect(
      queryFn({
        client: new QueryClient(),
        queryKey: options.queryKey,
        signal: controller.signal,
        meta: undefined,
      })
    ).rejects.toBe(closeError);
    expect(removeEventListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function)
    );
  });

  it.effect(
    "starts the replacement stream while the cancelled stream finalizer is still pending",
    () =>
      Effect.gen(function* replaceBeforeFinalization() {
        const Watch = Rpc.make("events.watch", {
          success: Schema.String,
          stream: true,
        });
        const streamGroup = RpcGroup.make(Watch);
        const firstStarted = yield* Deferred.make<boolean>();
        const firstFinalized = yield* Deferred.make<boolean>();
        const firstFinalizerStarted = yield* Deferred.make<boolean>();
        const releaseFirstFinalizer = yield* Deferred.make<boolean>();
        const secondStarted = yield* Deferred.make<boolean>();
        const secondFinalized = yield* Deferred.make<boolean>();
        let run = 0;
        /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
        const client = (() => {
          run += 1;
          const started = run === 1 ? firstStarted : secondStarted;
          const finalized = run === 1 ? firstFinalized : secondFinalized;
          const isFirst = run === 1;
          return Stream.make(`run-${String(run)}`).pipe(
            Stream.concat(
              Stream.fromEffect(
                Deferred.succeed(started, true).pipe(
                  Effect.andThen(Effect.never)
                )
              )
            ),
            Stream.ensuring(
              Effect.gen(function* finalizeCancelledRun() {
                if (isFirst) {
                  yield* Deferred.succeed(firstFinalizerStarted, true);
                  yield* Deferred.await(releaseFirstFinalizer);
                }
                yield* Deferred.succeed(finalized, true);
              })
            )
          );
        }) as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof streamGroup>>;
        /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion */
        const queryClient = new QueryClient();
        const options = createRpcQueryUtils(streamGroup, {
          client,
          keyPrefix: ["app"] as const,
        }).events.watch.streamedOptions();

        const firstFetch = captureFailure(queryClient.query(options));
        yield* Deferred.await(firstStarted);
        const refetch = captureFailure(
          queryClient.refetchQueries({
            exact: true,
            queryKey: options.queryKey,
          })
        );
        yield* Deferred.await(secondStarted);
        yield* Deferred.await(firstFinalizerStarted);
        const overlapped = !Deferred.isDoneUnsafe(firstFinalized);
        yield* Deferred.succeed(releaseFirstFinalizer, true);
        yield* Deferred.await(firstFinalized);
        yield* Effect.promise(async () => {
          await queryClient
            .cancelQueries({ queryKey: options.queryKey })
            .catch(() => {});
        });
        yield* Deferred.await(secondFinalized);

        yield* Effect.promise(async () => await firstFetch);
        expect(overlapped).toBe(true);
        expect(run).toBe(2);
        yield* Effect.promise(async () => await refetch);
      })
  );

  it.effect(
    "finalizes an active stream when its last observer unsubscribes",
    () =>
      Effect.gen(function* finalizeUnobservedStream() {
        const Watch = Rpc.make("events.watch", {
          success: Schema.String,
          stream: true,
        });
        const streamGroup = RpcGroup.make(Watch);
        const started = yield* Deferred.make<boolean>();
        const finalized = yield* Deferred.make<boolean>();
        const source = Stream.make("ready").pipe(
          Stream.concat(
            Stream.fromEffect(
              Deferred.succeed(started, true).pipe(Effect.andThen(Effect.never))
            )
          ),
          Stream.ensuring(Deferred.succeed(finalized, true).pipe(Effect.asVoid))
        );
        const client = yield* makeRpcTestClient(streamGroup, {
          "events.watch": () => source,
        });
        const queryClient = new QueryClient();
        const options = createRpcQueryUtils(streamGroup, {
          client,
          keyPrefix: ["app"] as const,
        }).events.watch.streamedOptions();
        const observer = new QueryObserver(queryClient, options);
        const unsubscribe = observer.subscribe(() => {});

        yield* Deferred.await(started);
        unsubscribe();
        yield* Deferred.await(finalized);
        expect(Deferred.isDoneUnsafe(finalized)).toBe(true);
      })
  );

  describe.each(["live", "streamed"] as const)(
    "preserves options and skips execution for the %s object form",
    (operation) => {
      it.effect("preserves options without executing a skipped stream", () =>
        Effect.gen(function* skipStreamExecution() {
          const Watch = Rpc.make("events.watch", {
            payload: { channel: Schema.String },
            success: Schema.String,
            stream: true,
          });
          const streamGroup = RpcGroup.make(Watch);
          const client = yield* makeRpcTestClient(streamGroup, {
            "events.watch": () => Stream.empty,
          });
          let executions = 0;
          const utils = createRpcQueryUtils(streamGroup, {
            client,
            keyPrefix: ["app"] as const,
            runPromiseExit: async (effect, options) => {
              executions += 1;
              return await Effect.runPromiseExit(effect, options);
            },
          });
          const callerOptions = Object.freeze({
            staleTime: 30_000,
            gcTime: 0,
            meta: { source: "conditional" },
          });
          const queryClient = new QueryClient();
          const observer =
            operation === "live"
              ? new QueryObserver(
                  queryClient,
                  utils.events.watch.liveOptions({
                    ...callerOptions,
                    input: skipToken,
                    initialData: "first",
                    select: (value) => value.length,
                  })
                )
              : new QueryObserver(
                  queryClient,
                  utils.events.watch.streamedOptions({
                    ...callerOptions,
                    input: skipToken,
                    refetchMode: "append",
                    initialData: ["first"],
                    select: (values) => values.length,
                  })
                );
          const { options } = observer;
          expect(options).toMatchObject({
            ...callerOptions,
            queryFn: skipToken,
            queryKey: ["app", "rpc", "events", "watch", operation],
          });
          expect({
            input: "input" in options,
            refetchMode: "refetchMode" in options,
            queryKeyHashFn: "queryKeyHashFn" in options,
          }).toStrictEqual({
            input: false,
            refetchMode: false,
            queryKeyHashFn: false,
          });
          const unsubscribe = observer.subscribe(() => {});
          yield* Effect.promise(async () => {
            await queryClient.invalidateQueries({
              queryKey: utils.events.key(),
            });
          });
          expect(observer.getCurrentResult()).toMatchObject({
            data: operation === "live" ? 5 : 1,
            fetchStatus: "idle",
          });
          expect(executions).toBe(0);
          unsubscribe();
          queryClient.clear();
        })
      );
    }
  );

  it.effect("reuses Query Core skipToken for payload-bearing streams", () =>
    Effect.gen(function* reuseStreamSkipToken() {
      const Watch = Rpc.make("events.watch", {
        payload: { channel: Schema.String },
        success: Schema.String,
        stream: true,
      });
      const streamGroup = RpcGroup.make(Watch);
      const client = yield* makeRpcTestClient(streamGroup, {
        "events.watch": () => Stream.empty,
      });
      const utils = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ["app"] as const,
      });

      expect(
        utils.events.watch.streamedOptions({ input: skipToken })
      ).toMatchObject({
        queryFn: skipToken,
        queryKey: ["app", "rpc", "events", "watch", "streamed"],
      });
      expect(
        utils.events.watch.liveOptions({ input: skipToken })
      ).toMatchObject({
        queryFn: skipToken,
        queryKey: ["app", "rpc", "events", "watch", "live"],
      });
    })
  );
});
