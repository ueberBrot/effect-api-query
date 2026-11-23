import {
  MutationCache,
  MutationObserver,
  QueryCache,
  QueryClient,
} from "@tanstack/query-core";
import { Effect, Exit, Layer, ManagedRuntime, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  acquireQueryOwner,
  configureUtils,
  createRpcQueryUtils,
  EffectHttpApiQueryEmptyStreamError,
  EffectRpcQueryEmptyStreamError,
  prepareInput,
} from "#effect-api-query";

import { group, makeClient, makeRpcTestClient } from "./fixtures/effect-rpc";

const gate = () => {
  let open!: () => void;
  // oxlint-disable-next-line promise/avoid-new
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

describe("query owners", () => {
  it("uses supplied cache callbacks with fresh caches for each owner", async () => {
    const observed: string[] = [];
    const onSuccess = () => {
      observed.push("fetched");
    };
    const caches = {
      queryCache: new QueryCache({ onSuccess }),
      mutationCache: new MutationCache(),
    };
    const old = await acquireQueryOwner(
      async () => await Promise.resolve("old"),
      caches
    );
    const next = await acquireQueryOwner(
      async () => await Promise.resolve("next"),
      caches
    );
    try {
      old.queryClient.setQueryData(["private"], "old");
      expect(next.queryClient.getQueryData(["private"])).toBeUndefined();
      await next.queryClient.query({
        queryKey: ["private"],
        queryFn: () => "next",
      });
      await old.dispose();
      expect({
        value: next.queryClient.getQueryData(["private"]),
        sharedMutationCache:
          next.queryClient.getMutationCache() === caches.mutationCache,
        observed,
      }).toStrictEqual({
        value: "next",
        sharedMutationCache: false,
        observed: ["fetched"],
      });
    } finally {
      await Promise.all([old.dispose(), next.dispose()]);
    }
  });

  it("retires once, rejects new work and releases acquired resources but not borrowed ones", async () => {
    const released: string[] = [];
    const borrowed = { close: () => released.push("borrowed") };
    const owner = await acquireQueryOwner(async (setup) => {
      setup.borrow(borrowed);
      await setup.acquire(
        () => "client",
        (value) => {
          released.push(value);
        }
      );
      return new QueryClient();
    });
    await Promise.all([owner.dispose(), owner.dispose()]);
    await expect(
      owner.runMutation(async () => await Promise.resolve(1))
    ).rejects.toThrow("retired");
    expect(released).toStrictEqual(["client"]);
  });

  it("releases earlier acquisitions after startup failure and preserves cleanup failures", async () => {
    const released: string[] = [];
    const startError = new Error("startup");
    const closeError = new Error("close");
    const started = acquireQueryOwner(async (setup) => {
      await setup.acquire(
        () => "first",
        (value) => {
          released.push(value);
        }
      );
      await setup.acquire(
        () => "second",
        () => {
          throw closeError;
        }
      );
      throw startError;
    });
    await expect(started).rejects.toMatchObject({
      errors: [startError, { errors: [closeError] }],
    });
    expect(released).toStrictEqual(["first"]);
  });

  it("drains the accepted native mutation and its callbacks without contaminating a replacement tenant", async () => {
    const old = await acquireQueryOwner(
      async () => await Promise.resolve("tenant-a")
    );
    const next = await acquireQueryOwner(
      async () => await Promise.resolve("tenant-b")
    );
    const response = gate();
    const callback = gate();
    const entered = gate();
    const observer = new MutationObserver(old.queryClient, {
      mutationFn: async () => {
        await response.promise;
        return "old";
      },
      onSuccess: async () => {
        entered.open();
        await callback.promise;
        old.commit((cache) => {
          cache.setQueryData(["user"], "old");
        });
      },
      networkMode: "always",
      retry: false,
    });
    const accepted = old.runMutation(async () => await observer.mutate());
    const disposed = old.dispose();
    let released = false;
    void disposed.then(() => {
      released = true;
      return true;
    });
    response.open();
    await entered.promise;
    expect(released).toBe(false);
    next.commit((cache) => {
      cache.setQueryData(["user"], "new");
    });
    callback.open();
    await accepted;
    await disposed;
    expect(old.queryClient.getQueryData(["user"])).toBeUndefined();
    expect(next.queryClient.getQueryData(["user"])).toBe("new");
    await next.dispose();
  });

  it("drains work that synchronously retires its own owner", async () => {
    const finish = gate();
    const released: string[] = [];
    const owner = await acquireQueryOwner(
      async (setup) =>
        await setup.acquire(
          () => "transport",
          (value) => {
            released.push(value);
          }
        )
    );
    const accepted = owner.runMutation(async () => {
      void owner.dispose();
      await finish.promise;
      return "finished";
    });
    expect(owner.isActive()).toBe(false);
    expect(released).toStrictEqual([]);
    finish.open();
    await expect(accepted).resolves.toBe("finished");
    await owner.dispose();
    expect(released).toStrictEqual(["transport"]);
  });

  it("waits for local query cleanup before releasing resources", async () => {
    const started = gate();
    const finalizing = gate();
    const cleanup = gate();
    const events: string[] = [];
    const owner = await acquireQueryOwner(
      async (setup) =>
        await setup.acquire(
          () => "transport",
          () => {
            events.push("released");
          }
        )
    );
    const run = owner.wrapRunner(Effect.runPromiseExit);
    const query = owner.queryClient.query({
      queryKey: ["pending"],
      retry: false,
      queryFn: async ({ signal }) => {
        const exit = await run(
          Effect.sync(() => {
            started.open();
          }).pipe(
            Effect.flatMap(() => Effect.never),
            Effect.ensuring(
              Effect.promise(async () => {
                finalizing.open();
                await cleanup.promise;
                events.push("cleaned");
              })
            )
          ),
          { signal }
        );
        return Exit.isSuccess(exit) ? exit.value : null;
      },
    });
    const cancelled = query.catch(() => null);
    await started.promise;
    const disposed = owner.dispose();
    await finalizing.promise;
    expect(events).toStrictEqual([]);
    cleanup.open();
    await disposed;
    await cancelled;
    expect(events).toStrictEqual(["cleaned", "released"]);
  });

  it("reports drain and release failures while attempting every release exactly once", async () => {
    const finish = gate();
    const events: string[] = [];
    const owner = await acquireQueryOwner(async (setup) => {
      await setup.acquire(
        () => "first",
        (value) => {
          events.push(value);
        }
      );
      await setup.acquire(
        () => "second",
        () => {
          throw new Error("release");
        }
      );
    });
    const mutation = owner.runMutation(async () => {
      await finish.promise;
      throw new Error("drain");
    });
    const observed = mutation.catch(() => null);
    const disposed = owner.dispose();
    finish.open();
    await expect(disposed).rejects.toMatchObject({
      errors: [new Error("drain"), new Error("release")],
    });
    await observed;
    expect(owner.dispose()).toBe(disposed);
    expect(events).toStrictEqual(["first"]);
  });

  it("preserves a cancelled query's failed finalizer Cause in the retirement outcome", async () => {
    const started = gate();
    const owner = await acquireQueryOwner(
      async () => await Promise.resolve(null)
    );
    const run = owner.wrapRunner(Effect.runPromiseExit);
    const result = run(
      Effect.sync(() => {
        started.open();
      }).pipe(
        Effect.flatMap(() => Effect.never),
        Effect.ensuring(Effect.die("finalizer failed"))
      ),
      { signal: new AbortController().signal }
    );
    await started.promise;
    const disposed = owner.dispose();
    const exit = await result;
    expect(Exit.isFailure(exit)).toBe(true);
    await expect(disposed).rejects.toMatchObject({
      errors: [Exit.isFailure(exit) ? exit.cause : undefined],
    });
  });

  it("reports a generated query finalizer failure once with its full Cause", async () => {
    const started = gate();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* verifyGeneratedQueryCleanup() {
          const client = yield* makeClient();
          const run = Effect.runPromiseExitWith(yield* Effect.context());
          const utilities = createRpcQueryUtils(group, {
            client,
            runtime: async (effect, options) =>
              await run(
                effect.pipe(
                  Effect.tap(() =>
                    Effect.sync(started.open).pipe(Effect.andThen(Effect.never))
                  ),
                  Effect.ensuring(Effect.die("finalizer failed"))
                ),
                options
              ),
          });
          yield* Effect.promise(async () => {
            const owner = await acquireQueryOwner(
              async (setup) =>
                await Promise.resolve(setup.trackUtils(utilities))
            );
            const query = owner.queryClient
              .query(owner.resources.health.ping.queryOptions({ retry: false }))
              .catch(() => null);
            await started.promise;
            await expect(owner.dispose()).rejects.toMatchObject({
              errors: [
                {
                  _tag: "EffectRpcQueryError",
                  cause: {
                    reasons: [
                      { _tag: "Interrupt" },
                      { _tag: "Die", defect: "finalizer failed" },
                    ],
                  },
                },
              ],
            });
            await query;
          });
        })
      )
    );
  });

  it("retires an accepted native accumulated stream before releasing its local transport", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* retireStreamOwner() {
          const started = gate();
          const cleaned = gate();
          const finalizing = gate();
          let released = false;
          const release = gate();
          const base = yield* makeRpcTestClient(group, {
            "events.watch": () =>
              Stream.fromEffect(
                Effect.sync(() => {
                  started.open();
                })
              ).pipe(
                Stream.flatMap(() => Stream.never),
                Stream.ensuring(
                  Effect.promise(async () => {
                    finalizing.open();
                    await cleaned.promise;
                  })
                )
              ),
            "health.ping": () => Effect.void,
            "toString.child": () => Effect.void,
            "diagnostics.fail": () => Effect.fail("declared-failure" as const),
            "users.get": (input) =>
              Effect.succeed({
                id: input.id,
                locale: input.locale ?? "en",
                name: "Ada",
              }),
          });
          yield* Effect.promise(async () => {
            const owner = await acquireQueryOwner(async (setup) => {
              await setup.acquire(
                () => base,
                () => {
                  released = true;
                  release.open();
                }
              );
              return configureUtils(
                createRpcQueryUtils(group, {
                  client: base,
                  keyPrefix: ["owner-stream"],
                  runtime: setup.wrapRunner(Effect.runPromiseExit),
                }),
                {
                  streamed: {
                    interceptors: [
                      async ({ next, context }) =>
                        await setup.runQuery(next, context.signal),
                    ],
                  },
                }
              );
            });
            const pending = owner.queryClient.query(
              owner.resources.events.watch.streamedOptions({
                retry: false,
                maxChunks: 10,
              })
            );
            const settled = pending.catch(() => null);
            await started.promise;
            const disposing = owner.dispose();
            await finalizing.promise;
            expect(released).toBe(false);
            cleaned.open();
            await disposing;
            await settled;
            await release.promise;
            expect(owner.queryClient.getQueryCache().getAll()).toStrictEqual(
              []
            );
          });
        })
      )
    );
  });

  it.each([undefined, 100] as const)(
    "retires an accepted native live stream (coalesceMs: %s) aborted before its first emission before releasing its local transport",
    async (coalesceMs) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* retireLiveStreamOwner() {
            const started = gate();
            const cleaned = gate();
            const finalizing = gate();
            let released = false;
            const release = gate();
            const base = yield* makeRpcTestClient(group, {
              "events.watch": () =>
                Stream.fromEffect(
                  Effect.sync(() => {
                    started.open();
                  })
                ).pipe(
                  Stream.flatMap(() => Stream.never),
                  Stream.ensuring(
                    Effect.promise(async () => {
                      finalizing.open();
                      await cleaned.promise;
                    })
                  )
                ),
              "health.ping": () => Effect.void,
              "toString.child": () => Effect.void,
              "diagnostics.fail": () =>
                Effect.fail("declared-failure" as const),
              "users.get": (input) =>
                Effect.succeed({
                  id: input.id,
                  locale: input.locale ?? "en",
                  name: "Ada",
                }),
            });
            yield* Effect.promise(async () => {
              const owner = await acquireQueryOwner(async (setup) => {
                await setup.acquire(
                  () => base,
                  () => {
                    released = true;
                    release.open();
                  }
                );
                return configureUtils(
                  createRpcQueryUtils(group, {
                    client: base,
                    keyPrefix: ["owner-live", coalesceMs ?? "none"],
                    runtime: setup.wrapRunner(Effect.runPromiseExit),
                  }),
                  {
                    live: {
                      interceptors: [
                        async ({ next, context }) =>
                          await setup.runQuery(next, context.signal),
                      ],
                    },
                  }
                );
              });
              const pending = owner.queryClient.query(
                owner.resources.events.watch.liveOptions({
                  retry: false,
                  ...(coalesceMs === undefined ? undefined : { coalesceMs }),
                })
              );
              const settled = pending.catch(() => null);
              await started.promise;
              const disposing = owner.dispose();
              await finalizing.promise;
              expect(released).toBe(false);
              cleaned.open();
              await disposing;
              await settled;
              await release.promise;
              expect(owner.queryClient.getQueryCache().getAll()).toStrictEqual(
                []
              );
            });
          })
        )
      );
    }
  );

  it.each([
    ["RPC", () => new EffectRpcQueryEmptyStreamError("events.watch")],
    [
      "HTTP",
      () =>
        new EffectHttpApiQueryEmptyStreamError({
          apiId: "empty-live",
          groupId: "events",
          endpoint: "watch",
          method: "GET",
        }),
    ],
  ] as const)(
    "does not classify %s empty-stream package errors as cancellations during retirement",
    async (_adapter, createError) => {
      const finish = gate();
      const owner = await acquireQueryOwner(
        async () => await Promise.resolve(null)
      );
      const controller = new AbortController();
      const emptyError = createError();
      const tracked = owner.runQuery(async () => {
        await finish.promise;
        throw emptyError;
      }, controller.signal);
      const observed = tracked.catch(() => null);
      controller.abort();
      const disposing = owner.dispose();
      finish.open();
      await expect(disposing).rejects.toMatchObject({
        errors: [emptyError],
      });
      await observed;
    }
  );

  it("wrapRunner accepts ManagedRuntime and object runtimes with receiver preserved", async () => {
    const managed = ManagedRuntime.make(Layer.empty);
    const owner = await acquireQueryOwner(
      async () => await Promise.resolve(null)
    );
    try {
      const wrappedManaged = owner.wrapRunner(managed);
      const exit = await wrappedManaged(Effect.succeed(42));

      let observedTag: string | undefined;
      const objRuntime = {
        tag: "owner-object-runtime",
        async runPromiseExit<A, E>(
          this: { readonly tag: string },
          effect: Effect.Effect<A, E>,
          options?: { readonly signal?: AbortSignal }
        ) {
          observedTag = this.tag;
          return await Effect.runPromiseExit(effect, options);
        },
      };
      const wrappedObj = owner.wrapRunner(objRuntime);
      const objExit = await wrappedObj(Effect.succeed("bound"));
      expect({
        managed: Exit.isSuccess(exit) ? exit.value : null,
        obj: Exit.isSuccess(objExit) ? objExit.value : null,
        observedTag,
      }).toStrictEqual({
        managed: 42,
        obj: "bound",
        observedTag: "owner-object-runtime",
      });
    } finally {
      await owner.dispose();
      await managed.dispose();
    }
  });

  it("trackUtils tracks runners, all query views, and mutations on roots, branches, and leaves", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* testTrackUtilsLifecycle() {
          const streamStarted = gate();
          const streamFinalizing = gate();
          const streamCleaned = gate();
          const mutationStarted = gate();
          const mutationFinish = gate();
          const events: string[] = [];

          const client = yield* makeRpcTestClient(group, {
            "events.watch": () =>
              Stream.fromEffect(
                Effect.sync(() => {
                  streamStarted.open();
                })
              ).pipe(
                Stream.flatMap(() => Stream.never),
                Stream.ensuring(
                  Effect.promise(async () => {
                    streamFinalizing.open();
                    await streamCleaned.promise;
                    events.push("stream-cleaned");
                  })
                )
              ),
            "health.ping": () => Effect.void,
            "toString.child": () => Effect.void,
            "diagnostics.fail": () => Effect.fail("declared-failure" as const),
            "users.get": (input) =>
              Effect.promise(async () => {
                if (input.id === 99) {
                  mutationStarted.open();
                  await mutationFinish.promise;
                  events.push("mutation-finished");
                }
                return {
                  id: input.id,
                  locale: input.locale ?? "en",
                  name: "Ada",
                };
              }),
          });

          yield* Effect.promise(async () => {
            const raw = createRpcQueryUtils(group, { client });
            const owner = await acquireQueryOwner(async (setup) => {
              await setup.acquire(
                () => "transport",
                () => {
                  events.push("released");
                }
              );
              return setup.trackUtils(raw);
            });

            const tracked = owner.resources;
            const user = await owner.queryClient.query(
              tracked.users.get.queryOptions({ input: { id: 1 } })
            );
            const infinite = await owner.queryClient.infiniteQuery(
              tracked.users.get.infiniteOptions({
                initialPageParam: 2,
                input: (id: number) => ({ id }),
                getNextPageParam: () => null,
              })
            );

            const pendingStream = owner.queryClient.query(
              tracked.events.watch.streamedOptions({
                retry: false,
                maxChunks: 10,
              })
            );
            const settledStream = pendingStream.catch(() => null);
            await streamStarted.promise;

            const mutation = new MutationObserver(
              owner.queryClient,
              tracked.users.get.mutationOptions()
            ).mutate({ id: 99 });
            await mutationStarted.promise;

            const disposing = owner.dispose();
            await streamFinalizing.promise;
            const eventsBeforeRelease = [...events];

            streamCleaned.open();
            mutationFinish.open();
            const mutated = await mutation;
            await disposing;
            await settledStream;
            expect({
              userId: user.id,
              infiniteId: infinite.pages[0]?.id,
              mutatedId: mutated.id,
              eventsBeforeRelease,
              events,
            }).toStrictEqual({
              userId: 1,
              infiniteId: 2,
              mutatedId: 99,
              eventsBeforeRelease: [],
              events: ["stream-cleaned", "mutation-finished", "released"],
            });

            await expect(
              owner.queryClient.query(
                tracked.users.get.queryOptions({
                  input: { id: 5 },
                  retry: false,
                })
              )
            ).rejects.toThrow("retired");
            await expect(
              new MutationObserver(
                owner.queryClient,
                tracked.users.get.mutationOptions()
              ).mutate({ id: 5 })
            ).rejects.toThrow("retired");
          });
        })
      )
    );
  });

  it.each(["configure first", "track first"] as const)(
    "drains an accepted mutation waiting in an interceptor when utilities %s",
    async (order) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.flatMap(makeClient(), (client) =>
            Effect.promise(async () => {
              const intercepted = gate();
              const resume = gate();
              const events: string[] = [];
              const raw = createRpcQueryUtils(group, {
                client,
                runtime: async (effect) => {
                  const exit = await Effect.runPromiseExit(effect);
                  events.push("wrote");
                  return exit;
                },
              });
              const owner = await acquireQueryOwner(async (setup) => {
                await setup.acquire(
                  () => "transport",
                  () => {
                    events.push("released");
                  }
                );
                const config = {
                  mutation: {
                    interceptors: [
                      async ({
                        next: execute,
                      }: {
                        readonly next: () => Promise<void>;
                      }) => {
                        intercepted.open();
                        await resume.promise;
                        await execute();
                      },
                    ],
                  },
                };
                return order === "configure first"
                  ? setup.trackUtils(configureUtils(raw.health.ping, config))
                  : configureUtils(setup.trackUtils(raw.health.ping), config);
              });
              const observer = new MutationObserver(
                owner.queryClient,
                owner.resources.mutationOptions({ retry: false })
              );
              const mutation = observer.mutate();
              await intercepted.promise;
              const disposal = owner.dispose();
              resume.open();
              await expect(
                Promise.all([mutation, disposal])
              ).resolves.toStrictEqual([undefined, undefined]);
              expect(events).toStrictEqual(["wrote", "released"]);
            })
          )
        )
      );
    }
  );

  it("trackUtils composes with configureUtils in both orders, preserves PreparedInput, is idempotent, and rejects cross-owner rebinding", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* testTrackUtilsComposition() {
          const client = yield* makeRpcTestClient(group, {
            "events.watch": () => Stream.fromIterable(["a", "b"]),
            "health.ping": () => Effect.void,
            "toString.child": () => Effect.void,
            "diagnostics.fail": () => Effect.fail("declared-failure" as const),
            "users.get": (input) =>
              Effect.succeed({
                id: input.id,
                locale: input.locale ?? "en",
                name: "Ada",
              }),
          });

          yield* Effect.promise(async () => {
            const raw = createRpcQueryUtils(group, { client });
            const ownerA = await acquireQueryOwner(
              async () => await Promise.resolve("a")
            );
            const ownerB = await acquireQueryOwner(
              async () => await Promise.resolve("b")
            );
            try {
              const interceptorCalls: string[] = [];
              const config = {
                query: {
                  interceptors: [
                    async <T>({
                      next,
                    }: {
                      readonly next: () => Promise<T>;
                    }) => {
                      interceptorCalls.push("query");
                      return await next();
                    },
                  ],
                },
                streamed: { maxChunks: 5 as const },
              };

              const configuredThenTracked = ownerA.trackUtils(
                configureUtils(raw, config)
              );
              const trackedThenConfigured = configureUtils(
                ownerA.trackUtils(raw),
                config
              );

              const preparedFromRaw = prepareInput(raw.users.get, { id: 10 });
              const preparedFromTracked = prepareInput(
                configuredThenTracked.users.get,
                { id: 11 }
              );

              const res1 = await ownerA.queryClient.query(
                configuredThenTracked.users.get.queryOptions({
                  input: preparedFromRaw,
                })
              );
              const res2 = await ownerA.queryClient.query(
                trackedThenConfigured.users.get.queryOptions({
                  input: preparedFromTracked,
                })
              );
              const chunks1 = await ownerA.queryClient.query(
                configuredThenTracked.events.watch.streamedOptions()
              );
              const chunks2 = await ownerA.queryClient.query(
                trackedThenConfigured.events.watch.streamedOptions()
              );
              const trackedRoot = ownerA.trackUtils(raw);
              const trackedBranch = ownerA.trackUtils(raw.users);
              const trackedLeaf = ownerA.trackUtils(raw.users.get);
              const branchRes = await ownerA.queryClient.query(
                trackedBranch.get.queryOptions({ input: { id: 12 } })
              );
              const leafRes = await ownerA.queryClient.query(
                trackedLeaf.queryOptions({ input: { id: 13 } })
              );
              expect({
                ids: [res1.id, res2.id, branchRes.id, leafRes.id],
                interceptorCalls,
                chunks1,
                chunks2,
                idempotentRoot: ownerA.trackUtils(trackedRoot) === trackedRoot,
                idempotentBranch:
                  ownerA.trackUtils(trackedRoot.users) === trackedRoot.users,
                idempotentLeaf:
                  ownerA.trackUtils(trackedRoot.users.get) ===
                  trackedRoot.users.get,
                idempotentConfigured:
                  ownerA.trackUtils(trackedThenConfigured) ===
                  trackedThenConfigured,
              }).toStrictEqual({
                ids: [10, 11, 12, 13],
                interceptorCalls: ["query", "query"],
                chunks1: ["a", "b"],
                chunks2: ["a", "b"],
                idempotentRoot: true,
                idempotentBranch: true,
                idempotentLeaf: true,
                idempotentConfigured: true,
              });

              expect(() => ownerB.trackUtils(trackedRoot)).toThrow(
                "already tracked"
              );
              expect(() => ownerB.trackUtils(trackedRoot.users)).toThrow(
                "already tracked"
              );
              expect(() => ownerB.trackUtils(trackedThenConfigured)).toThrow(
                "already tracked"
              );
              expect(() => ownerB.trackUtils(configuredThenTracked)).toThrow(
                "already tracked"
              );
            } finally {
              await Promise.all([ownerA.dispose(), ownerB.dispose()]);
            }
          });
        })
      )
    );
  });

  it("wrapRunner with interruptOnRetire interrupts Effects without a caller signal and drains finalizers before release", async () => {
    const started = gate();
    const finalizing = gate();
    const cleanup = gate();
    const events: string[] = [];
    const owner = await acquireQueryOwner(
      async (setup) =>
        await setup.acquire(
          () => "transport",
          () => {
            events.push("released");
          }
        )
    );
    const run = owner.wrapRunner(Effect.runPromiseExit, {
      interruptOnRetire: true,
    });
    const result = run(
      Effect.sync(() => {
        started.open();
      }).pipe(
        Effect.flatMap(() => Effect.never),
        Effect.ensuring(
          Effect.promise(async () => {
            finalizing.open();
            await cleanup.promise;
            events.push("cleaned");
          })
        )
      )
    );
    await started.promise;
    const disposed = owner.dispose();
    await finalizing.promise;
    expect(events).toStrictEqual([]);
    cleanup.open();
    await disposed;
    const exit = await result;
    expect(Exit.isFailure(exit)).toBe(true);
    expect(events).toStrictEqual(["cleaned", "released"]);
  });

  it("wrapRunner with interruptOnRetire still honors a caller AbortSignal before retirement", async () => {
    const started = gate();
    const owner = await acquireQueryOwner(
      async () => await Promise.resolve(null)
    );
    const run = owner.wrapRunner(Effect.runPromiseExit, {
      interruptOnRetire: true,
    });
    const controller = new AbortController();
    const result = run(
      Effect.sync(() => {
        started.open();
      }).pipe(Effect.flatMap(() => Effect.never)),
      { signal: controller.signal }
    );
    await started.promise;
    controller.abort();
    const exit = await result;
    expect(Exit.isFailure(exit)).toBe(true);
    expect(owner.isActive()).toBe(true);
    await owner.dispose();
  });

  it("wrapRunner with interruptOnRetire: false drains on retirement even when a caller signal is supplied", async () => {
    const started = gate();
    const finish = gate();
    const events: string[] = [];
    const owner = await acquireQueryOwner(
      async (setup) =>
        await setup.acquire(
          () => "transport",
          () => {
            events.push("released");
          }
        )
    );
    const run = owner.wrapRunner(Effect.runPromiseExit, {
      interruptOnRetire: false,
    });
    const controller = new AbortController();
    const result = run(
      Effect.promise(async () => {
        started.open();
        await finish.promise;
        events.push("finished");
        return "done";
      }),
      { signal: controller.signal }
    );
    await started.promise;
    const disposed = owner.dispose();
    await Promise.resolve();
    expect(controller.signal.aborted).toBe(false);
    expect(events).toStrictEqual([]);
    finish.open();
    await disposed;
    await expect(result).resolves.toStrictEqual(Exit.succeed("done"));
    expect(events).toStrictEqual(["finished", "released"]);
  });
});
