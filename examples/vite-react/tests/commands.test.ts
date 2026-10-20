import { startExampleRpcServer } from "@effect-api-query/server";
import { MutationObserver, QueryObserver } from "@tanstack/react-query";
import { Effect, Exit, Scope } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { startViteReactApplication } from "../src/lib/application.ts";
import type { ViteReactApplication } from "../src/lib/application.ts";

describe("Cancellable commands", () => {
  it("drains an accepted command before replacing its owner and preserves completed work", async () => {
    const serverScope = await Effect.runPromise(Scope.make());
    let previous: ViteReactApplication | undefined;
    let current: ViteReactApplication | undefined;
    try {
      const server = await Effect.runPromise(
        startExampleRpcServer().pipe(Scope.provide(serverScope))
      );
      previous = await startViteReactApplication({ rpcUrl: server.rpcUrl });
      const captured = previous;
      const input = { operationId: "owner-handoff", steps: 10 };
      const start = new MutationObserver(
        captured.queryClient,
        captured.trackMutationOptions(
          captured.rpcQuery.commands.start.mutationOptions({
            onSettled: async () => {
              if (captured.isActive()) {
                await captured.queryClient.invalidateQueries({
                  queryKey: captured.rpcQuery.commands.status.queryKey(input),
                });
              }
            },
          })
        )
      );
      const accepted = start.mutate(input);
      const statusOptions = captured.rpcQuery.commands.status.queryOptions({
        input,
      });
      await expect
        .poll(async () => {
          const status = await captured.queryClient.query(statusOptions);
          return status?.completedSteps ?? 0;
        })
        .toBeGreaterThan(0);
      expect({
        state: captured.queryClient.getQueryData(statusOptions.queryKey)?.state,
        mutation: start.getCurrentResult().status,
      }).toStrictEqual({ state: "running", mutation: "pending" });

      const retiring = captured.dispose();
      expect(captured.isActive()).toBe(false);
      const completed = await accepted;
      await retiring;
      expect({
        completed,
        mutation: start.getCurrentResult().status,
        queries: captured.queryClient.getQueryCache().getAll(),
        mutations: captured.queryClient.getMutationCache().getAll(),
      }).toMatchObject({
        completed: {
          operationId: "owner-handoff",
          state: "completed",
          completedSteps: 10,
          totalSteps: 10,
        },
        mutation: "success",
        queries: [],
        mutations: [],
      });

      current = await startViteReactApplication({
        rpcUrl: server.rpcUrl,
        identity: { ...captured.identity, permissionGeneration: 2 },
      });
      const replacementStart = new MutationObserver(
        current.queryClient,
        current.trackMutationOptions(
          current.rpcQuery.commands.start.mutationOptions()
        )
      );
      expect({
        mutation: replacementStart.getCurrentResult().status,
        mutations: current.queryClient.getMutationCache().getAll(),
        completed: await current.queryClient.query(
          current.rpcQuery.commands.status.queryOptions({ input })
        ),
      }).toStrictEqual({ mutation: "idle", mutations: [], completed });
    } finally {
      await previous?.dispose();
      await current?.dispose();
      await Effect.runPromise(Scope.close(serverScope, Exit.void));
    }
  });

  it("cancels a pending command, reconciles cached progress, and isolates another command", async () => {
    const scope = await Effect.runPromise(Scope.make());
    const server = await Effect.runPromise(
      startExampleRpcServer().pipe(Scope.provide(scope))
    );
    const application = await startViteReactApplication({
      rpcUrl: server.rpcUrl,
    });
    const { queryClient, rpcQuery } = application;
    const firstInput = { operationId: "first", steps: 40 };
    const secondInput = { operationId: "second", steps: 10 };
    const statusOptions = rpcQuery.commands.status.queryOptions({
      input: firstInput,
      staleTime: Infinity,
    });
    const observer = new QueryObserver(queryClient, statusOptions);
    const unsubscribe = observer.subscribe(() => {});
    const events: string[] = [];
    const first = new MutationObserver(
      queryClient,
      rpcQuery.commands.start.mutationOptions({
        onSuccess: () => {
          events.push("success");
        },
        onSettled: () => {
          events.push("settled");
        },
      })
    );
    const second = new MutationObserver(
      queryClient,
      rpcQuery.commands.start.mutationOptions()
    );
    try {
      const firstResult = first.mutate(firstInput);
      const secondResult = second.mutate(secondInput);
      await expect
        .poll(async () => {
          await queryClient.invalidateQueries({
            queryKey: statusOptions.queryKey,
          });
          return (
            queryClient.getQueryData(statusOptions.queryKey)?.completedSteps ??
            0
          );
        })
        .toBeGreaterThan(0);
      const pendingStatus = first.getCurrentResult().status;
      const cancel = new MutationObserver(
        queryClient,
        rpcQuery.commands.cancel.mutationOptions({
          onSettled: async () => {
            await queryClient.invalidateQueries({
              queryKey: rpcQuery.commands.status.queryKey(firstInput),
            });
          },
        })
      );
      const cancelled = await cancel.mutate(firstInput);
      expect({
        pendingStatus,
        state: cancelled.state,
        cached: queryClient.getQueryData(statusOptions.queryKey),
      }).toStrictEqual({
        pendingStatus: "pending",
        state: "cancelled",
        cached: cancelled,
      });
      expect(cancelled.completedSteps).toBeLessThan(40);
      const completed = await firstResult;
      const mutationStatus = first.getCurrentResult().status;
      const settledEvents = [...events];
      await expect(secondResult).resolves.toMatchObject({
        operationId: "second",
        state: "completed",
        completedSteps: 10,
      });
      expect({
        completed,
        mutation: mutationStatus,
        events: settledEvents,
        refreshed: await queryClient.query({ ...statusOptions, staleTime: 0 }),
      }).toStrictEqual({
        completed: cancelled,
        mutation: "success",
        events: ["success", "settled"],
        refreshed: cancelled,
      });
    } finally {
      unsubscribe();
      await application.dispose();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("keeps command IDs idempotent across early cancellation, completion, and reset", async () => {
    const scope = await Effect.runPromise(Scope.make());
    const server = await Effect.runPromise(
      startExampleRpcServer().pipe(Scope.provide(scope))
    );
    const application = await startViteReactApplication({
      rpcUrl: server.rpcUrl,
    });
    const { queryClient, rpcQuery } = application;
    const start = new MutationObserver(
      queryClient,
      rpcQuery.commands.start.mutationOptions()
    );
    const cancel = new MutationObserver(
      queryClient,
      rpcQuery.commands.cancel.mutationOptions()
    );
    const input = { operationId: "repeat", steps: 2 };
    try {
      await expect(
        queryClient.query(rpcQuery.commands.status.queryOptions({ input }))
      ).resolves.toBeNull();
      const cancelled = await cancel.mutate(input);
      expect(cancelled).toMatchObject({
        state: "cancelled",
        completedSteps: 0,
      });
      expect({
        started: await start.mutate(input),
        cancelled: await cancel.mutate(input),
      }).toStrictEqual({ started: cancelled, cancelled });

      const reset = new MutationObserver(
        queryClient,
        rpcQuery.testing.reset.mutationOptions()
      );
      await reset.mutate();
      const [completed, duplicate] = await Promise.all([
        start.mutate(input),
        start.mutate(input),
      ]);
      expect(completed).toMatchObject({
        state: "completed",
        completedSteps: 2,
        totalSteps: 2,
      });
      expect({
        duplicate,
        cancelled: await cancel.mutate(input),
        restarted: await start.mutate({ ...input, steps: 100 }),
      }).toStrictEqual({
        duplicate: completed,
        cancelled: completed,
        restarted: completed,
      });
    } finally {
      await application.dispose();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });

  it("resets running commands before allowing their operation IDs to be reused", async () => {
    const scope = await Effect.runPromise(Scope.make());
    const server = await Effect.runPromise(
      startExampleRpcServer().pipe(Scope.provide(scope))
    );
    const application = await startViteReactApplication({
      rpcUrl: server.rpcUrl,
    });
    const { queryClient, rpcQuery } = application;
    const input = { operationId: "reset-running" };
    const options = rpcQuery.commands.status.queryOptions({ input });
    try {
      const start = new MutationObserver(
        queryClient,
        rpcQuery.commands.start.mutationOptions()
      );
      const running = start.mutate(input);
      await expect
        .poll(async () => {
          const status = await queryClient.query(options);
          return status?.completedSteps ?? 0;
        })
        .toBeGreaterThan(0);
      const reset = new MutationObserver(
        queryClient,
        rpcQuery.testing.reset.mutationOptions()
      );
      await reset.mutate();
      await expect(running).resolves.toMatchObject({
        state: "cancelled",
        totalSteps: 40,
      });
      await expect(queryClient.query(options)).resolves.toBeNull();
      await expect(start.mutate({ ...input, steps: 1 })).resolves.toMatchObject(
        {
          state: "completed",
          completedSteps: 1,
        }
      );
    } finally {
      await application.dispose();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  });
});
