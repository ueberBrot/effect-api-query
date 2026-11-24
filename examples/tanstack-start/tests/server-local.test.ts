import { randomUUID } from "node:crypto";

import { createMemoryHistory } from "@tanstack/react-router";
import { Effect, Exit, Scope } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { makeExampleHost } from "../../server/src/web-handler.ts";
import { openOperationSession } from "../../server/tests/fixtures/operation-session.ts";
import type { TanStackStartApplication } from "../src/lib/application.ts";
import { startServerApplication } from "../src/lib/server-application.ts";
import { createTanStackStartRouter } from "../src/router.tsx";

describe("Start request-local execution", () => {
  const applications: TanStackStartApplication[] = [];
  const scope = Scope.makeUnsafe();

  afterEach(async () => {
    await Promise.all(
      applications.splice(0).map(async ({ dispose }) => {
        await dispose();
      })
    );
    vi.unstubAllGlobals();
  });

  it("rejects RPC page inputs that cannot advance through the directory", async () => {
    const ownerScope = Scope.makeUnsafe();
    const host = await Effect.runPromise(
      makeExampleHost().pipe(Scope.provide(ownerScope))
    );
    const application = await startServerApplication({
      host,
    });
    try {
      for (const input of [
        { cursor: -1, pageSize: 4 },
        { cursor: 0, pageSize: 0 },
        { cursor: 0, pageSize: 101 },
      ]) {
        expect(() =>
          application.rpcQuery.users.page.queryOptions({ input })
        ).toThrow("Could not construct the payload for RPC users.page");
      }
      await expect(
        application.queryClient.query(
          application.rpcQuery.users.page.queryOptions({
            input: { cursor: 0, pageSize: 1 },
          })
        )
      ).resolves.toMatchObject({
        nextCursor: 1,
        total: 12,
        users: [{ id: 1 }],
      });
      await expect(
        application.queryClient.query(
          application.rpcQuery.users.page.queryOptions({
            input: { cursor: 0, pageSize: 100 },
          })
        )
      ).resolves.toMatchObject({ nextCursor: null, total: 12 });
      expect(application.queryClient.getQueryCache().getAll()).toHaveLength(2);
    } finally {
      await application.dispose();
      await Effect.runPromise(Scope.close(ownerScope, Exit.void));
    }
  });

  it("renders shared host state without network calls and isolates request authority", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await Effect.runPromise(Effect.yieldNow);
        throw new Error("Unexpected network request");
      })
    );
    const writeToken = randomUUID();
    const host = await Effect.runPromise(
      makeExampleHost(writeToken).pipe(Scope.provide(scope))
    );
    try {
      const allowed = await startServerApplication({
        host,
        identity: "writer",
        request: new Request("http://example.local/", {
          headers: { authorization: `Bearer ${writeToken}` },
        }),
      });
      const denied = await startServerApplication({
        host,
        identity: "restricted",
        request: new Request("http://example.local/"),
      });
      applications.push(allowed, denied);
      const create = allowed.rpcQuery.users.create.mutationOptions().mutationFn;
      if (create === undefined) {
        throw new Error("Mutation function is missing");
      }
      await create({ name: "Shared SSR user" });
      const router = await createTanStackStartRouter({
        application: allowed,
        history: createMemoryHistory({ initialEntries: ["/"] }),
      });
      await router.load();
      expect({
        allowedCount: allowed.queryClient.getQueryData(
          allowed.rpcQuery.users.list.queryKey()
        )?.length,
        deniedUsers: denied.queryClient.getQueryData(
          denied.rpcQuery.users.list.queryKey()
        ),
      }).toStrictEqual({ allowedCount: 13, deniedUsers: undefined });
      expect(allowed.rpcQuery.users.list.queryKey()).not.toStrictEqual(
        denied.rpcQuery.users.list.queryKey()
      );
      const remove = denied.rpcQuery.users.delete.mutationOptions({
        rpcOptions: { headers: { authorization: `Bearer ${writeToken}` } },
      }).mutationFn;
      if (remove === undefined) {
        throw new Error("Mutation function is missing");
      }
      await expect(remove({ id: 1 })).rejects.toMatchObject({
        name: "EffectRpcQueryError",
      });
      await allowed.rpcQuery.users.delete
        .mutationOptions()
        .mutationFn({ id: 1 });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      await allowed.dispose();
      await expect(
        denied.queryClient.query(denied.rpcQuery.users.list.queryOptions())
      ).resolves.toHaveLength(12);
    } finally {
      await Promise.all(
        applications.splice(0).map(async ({ dispose }) => {
          await dispose();
        })
      );
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("settles an aborted capture before releasing its request clients", async () => {
    const ownerScope = Scope.makeUnsafe();
    const host = await Effect.runPromise(
      makeExampleHost().pipe(Scope.provide(ownerScope))
    );
    const events: string[] = [];
    const application = await startServerApplication({
      host: {
        ...host,
        forRequest: (request) => {
          const local = host.forRequest(request);
          return {
            ...local,
            makeRpcClient: Effect.fnUntraced(function* makeRpcClient() {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  events.push("released");
                })
              );
              return yield* local.makeRpcClient();
            }),
          };
        },
      },
    });
    try {
      const capture = application.captureSnapshot(
        application.queryClient,
        application.rpcQuery.diagnostics.stream.streamedOptions({
          maxChunks: "unbounded",
        })
      );
      const failure = (async () => {
        try {
          await capture;
          return null;
        } catch (error) {
          return error;
        } finally {
          events.push("settled");
        }
      })();
      expect(application.queryClient.isFetching()).toBe(1);
      await application.dispose();
      await expect(failure).resolves.toMatchObject({ name: "AbortError" });
      expect(events).toStrictEqual(["settled", "released"]);
      expect(application.queryClient.getQueryCache().hasListeners()).toBe(
        false
      );
      expect(application.queryClient.getQueryCache().getAll()).toHaveLength(0);
    } finally {
      await application.dispose();
      await Effect.runPromise(Scope.close(ownerScope, Exit.void));
    }
  });

  it("finishes interrupted local work while another request remains usable", async () => {
    const ownerScope = Scope.makeUnsafe();
    const host = await Effect.runPromise(
      makeExampleHost().pipe(Scope.provide(ownerScope))
    );
    const abort = new AbortController();
    const session = await openOperationSession(
      "http://localhost",
      host.handleRequest
    );
    const first = await startServerApplication({
      host,
      request: session.request("/", { signal: abort.signal }),
    });
    const second = await startServerApplication({
      host,
      request: session.request("/"),
    });
    try {
      const read = first.queryClient.query(
        first.rpcQuery.diagnostics.slow.queryOptions({
          input: {
            operationId: "retired-request",
            durationMs: 60_000,
          },
        })
      );
      const rejected = (async () => {
        await expect(read).rejects.toMatchObject({ message: "CancelledError" });
      })();
      await expect
        .poll(
          async () =>
            await second.queryClient.query({
              ...second.rpcQuery.diagnostics.operationStatus.queryOptions({
                input: {
                  operationId: "retired-request",
                },
              }),
              staleTime: 0,
            })
        )
        .toMatchObject({ started: 1, interrupted: 0 });
      abort.abort();
      await first.dispose();
      await rejected;
      await expect(
        second.queryClient.query({
          ...second.rpcQuery.diagnostics.operationStatus.queryOptions({
            input: {
              operationId: "retired-request",
            },
          }),
          staleTime: 0,
        })
      ).resolves.toStrictEqual({ started: 1, interrupted: 1 });
      await expect(
        second.queryClient.query(second.httpQuery.users.list.queryOptions())
      ).resolves.toHaveLength(12);
    } finally {
      await Promise.all([first.dispose(), second.dispose()]);
      await Effect.runPromise(Scope.close(ownerScope, Exit.void));
    }
  });

  it("isolates omitted diagnostic IDs and forwards the verified session to local HTTP", async () => {
    const hostScope = Scope.makeUnsafe();
    const host = await Effect.runPromise(
      makeExampleHost().pipe(Scope.provide(hostScope))
    );
    const origin = "http://localhost";
    const [session, otherSession] = await Promise.all([
      openOperationSession(origin, host.handleRequest),
      openOperationSession(origin, host.handleRequest),
    ]);
    const [owner, other] = await Promise.all([
      startServerApplication({ host, request: session.request("/") }),
      startServerApplication({ host, request: otherSession.request("/") }),
    ]);
    try {
      await Promise.all([
        owner.rpcQuery.diagnostics.slow.call({ input: { durationMs: 0 } }),
        other.rpcQuery.diagnostics.slow.call({ input: { durationMs: 0 } }),
      ]);
      await owner.rpcQuery.diagnostics.slow.call({ input: { durationMs: 0 } });
      const input = { params: { operationId: "anonymous" } };
      await expect(
        owner.httpQuery.diagnostics.operationStatus.call({ input })
      ).resolves.toStrictEqual({ started: 2, interrupted: 0 });
      await expect(
        other.httpQuery.diagnostics.operationStatus.call({ input })
      ).resolves.toStrictEqual({ started: 1, interrupted: 0 });
    } finally {
      await Promise.all([owner.dispose(), other.dispose()]);
      await Effect.runPromise(Scope.close(hostScope, Exit.void));
    }
  });

  it("reports aborted request cleanup failures and preserves explicit disposal rejection", async () => {
    const ownerScope = Scope.makeUnsafe();
    const host = await Effect.runPromise(
      makeExampleHost().pipe(Scope.provide(ownerScope))
    );
    const abort = new AbortController();
    const failure = new Error("Request resource finalizer failed");
    // oxlint-disable-next-line unicorn/no-useless-undefined
    const log = vi.spyOn(console, "error").mockReturnValue(undefined);
    const application = await startServerApplication({
      host: {
        ...host,
        forRequest: (request) => {
          const local = host.forRequest(request);
          return {
            ...local,
            makeRpcClient: Effect.fnUntraced(function* makeRpcClient() {
              yield* Effect.addFinalizer(() => Effect.die(failure));
              return yield* local.makeRpcClient();
            }),
          };
        },
      },
      request: new Request("http://example.local/", { signal: abort.signal }),
    });
    try {
      abort.abort();
      await expect(application.dispose()).rejects.toBe(failure);
      expect(log).toHaveBeenCalledWith(
        "Start resource cleanup failed",
        failure
      );
    } finally {
      log.mockRestore();
      await Effect.runPromise(Scope.close(ownerScope, Exit.void));
    }
  });
});
