import { MutationObserver, QueryClient } from "@tanstack/query-core";
import { Effect, Exit, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  acquireQueryOwner,
  configureUtils,
  createRpcQueryUtils,
} from "#effect-api-query";

import { group, makeRpcTestClient } from "./fixtures/effect-rpc";

const gate = () => {
  let open!: () => void;
  // Controlled external completion boundary for drain tests.
  // oxlint-disable-next-line promise/avoid-new
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

describe("query owners", () => {
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
    await expect(disposed).rejects.toBeInstanceOf(AggregateError);
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
                  runPromiseExit: setup.wrapRunner(Effect.runPromiseExit),
                }),
                {
                  streamed: {
                    interceptors: [
                      async ({ next }) => await setup.runQuery(next),
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
});
