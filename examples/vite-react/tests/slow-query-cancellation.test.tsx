// @vitest-environment jsdom

import { OperationNotFound } from "@effect-api-query/contracts";
import type { DiagnosticOperationStatus } from "@effect-api-query/contracts";
import { useSlowQueryCancellation } from "@effect-api-query/shared/use-slow-query-cancellation.ts";
import { QueryClient } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  EffectHttpApiQueryError,
  EffectRpcQueryError,
} from "@ueberbrot/effect-api-query";
import { Cause, Deferred, Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

interface SlowInput {
  readonly durationMs: number;
  readonly operationId: string;
}
interface StatusInput {
  readonly operationId: string;
}
type Transport = "rpc" | "http";

const makeApplication = ({
  readStatus,
  isActive = () => true,
  slowResult = Effect.never,
}: {
  readonly readStatus?: (
    status: DiagnosticOperationStatus
  ) => Effect.Effect<DiagnosticOperationStatus, Error>;
  readonly isActive?: () => boolean;
  readonly slowResult?: Effect.Effect<string, Error>;
} = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  const operations = new Map<string, DiagnosticOperationStatus>();
  const statusSignals: AbortSignal[] = [];
  const status = (operationId: string) =>
    operations.get(operationId) ?? { started: 0, interrupted: 0, completed: 0 };
  const slow = Effect.fnUntraced(function* slow({ operationId }: SlowInput) {
    operations.set(operationId, { ...status(operationId), started: 1 });
    return yield* slowResult.pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          operations.set(operationId, {
            ...status(operationId),
            interrupted: 1,
          });
        })
      )
    );
  });
  const slowQuery = (transport: Transport, input: SlowInput) => ({
    queryKey: [transport, "slow", input.operationId],
    queryFn: async ({ signal }: QueryFunctionContext) =>
      await Effect.runPromise(slow(input), { signal }),
  });
  const callStatus = async (
    { operationId }: StatusInput,
    signal: AbortSignal
  ) => {
    statusSignals.push(signal);
    const current = status(operationId);
    return await Effect.runPromise(
      readStatus?.(current) ?? Effect.succeed(current),
      { signal }
    );
  };

  const application = {
    queryClient,
    isActive,
    rpcQuery: {
      diagnostics: {
        slow: {
          queryOptions: ({ input }: { readonly input: SlowInput }) =>
            slowQuery("rpc", input),
        },
        operationStatus: {
          call: async ({
            input,
            signal,
          }: {
            readonly input: StatusInput;
            readonly signal: AbortSignal;
          }) => await callStatus(input, signal),
        },
      },
    },
    httpQuery: {
      diagnostics: {
        slow: {
          queryOptions: ({
            input,
          }: {
            readonly input: { readonly query: SlowInput };
          }) => slowQuery("http", input.query),
        },
        operationStatus: {
          call: async ({
            input,
            signal,
          }: {
            readonly input: { readonly params: StatusInput };
            readonly signal: AbortSignal;
          }) => await callStatus(input.params, signal),
        },
      },
    },
  };
  return { application, operations, statusSignals };
};

describe("shared slow-query cancellation lifetime", () => {
  afterEach(cleanup);

  it.each([
    { transport: "rpc", outcome: "Completed" },
    { transport: "rpc", outcome: "Failed" },
    { transport: "http", outcome: "Completed" },
    { transport: "http", outcome: "Failed" },
  ] as const)(
    "settles a ready $transport query as $outcome and starts again with a fresh ID",
    async ({ transport, outcome }) => {
      const result = Deferred.makeUnsafe<string, Error>();
      const failure = new Error("slow query failed");
      const { application, operations } = makeApplication({
        slowResult: Deferred.await(result),
      });
      const hook = renderHook(() =>
        useSlowQueryCancellation(application, transport)
      );
      try {
        await act(async () => {
          await hook.result.current.start();
        });
        expect(hook.result.current.canCancel).toBe(true);
        const cancelReadyRun = hook.result.current.cancel;
        await act(async () => {
          await Effect.runPromise(
            outcome === "Completed"
              ? Deferred.succeed(result, "completed")
              : Deferred.fail(result, failure)
          );
        });
        await waitFor(() => {
          expect(hook.result.current.state).toStrictEqual(
            outcome === "Completed"
              ? { _tag: outcome }
              : { _tag: outcome, error: failure }
          );
        });
        expect(hook.result.current.canCancel).toBe(false);
        expect(hook.result.current.canStart).toBe(true);
        await act(cancelReadyRun);
        expect(hook.result.current.state._tag).toBe(outcome);

        await act(async () => {
          await hook.result.current.start();
        });
        expect([...operations.values()]).toStrictEqual([
          { started: 1, interrupted: 0, completed: 0 },
          { started: 1, interrupted: 0, completed: 0 },
        ]);
      } finally {
        hook.unmount();
        await application.queryClient.cancelQueries();
        application.queryClient.clear();
      }
    }
  );

  it.each(["rpc", "http"] as const)(
    "reports completion when the %s server finishes before Cancel aborts the response",
    async (transport) => {
      let serverCompleted = false;
      const { application } = makeApplication({
        readStatus: (status) =>
          Effect.succeed(
            serverCompleted
              ? { ...status, completed: 1, interrupted: 0 }
              : status
          ),
      });
      const hook = renderHook(() =>
        useSlowQueryCancellation(application, transport)
      );
      try {
        await act(async () => {
          await hook.result.current.start();
        });
        expect(hook.result.current.canCancel).toBe(true);
        serverCompleted = true;
        await act(async () => {
          await hook.result.current.cancel();
        });
        expect(hook.result.current.state).toStrictEqual({ _tag: "Completed" });
        expect(hook.result.current.canStart).toBe(true);
        expect(hook.result.current.canCancel).toBe(false);
      } finally {
        hook.unmount();
        await application.queryClient.cancelQueries();
        application.queryClient.clear();
      }
    }
  );

  it.each(["rpc", "http"] as const)(
    "can start again when the %s cancellation outcome is no longer retained",
    async (transport) => {
      let retained = true;
      const cause = Cause.fail(OperationNotFound.literal);
      const missing =
        transport === "rpc"
          ? new EffectRpcQueryError(
              "diagnostics.operationStatus",
              "call",
              cause
            )
          : new EffectHttpApiQueryError(
              {
                apiId: "ExampleApi",
                groupId: "diagnostics",
                endpoint: "operationStatus",
                method: "GET",
              },
              "call",
              cause
            );
      const { application } = makeApplication({
        readStatus: (status) =>
          retained ? Effect.succeed(status) : Effect.fail(missing),
      });
      const hook = renderHook(() =>
        useSlowQueryCancellation(application, transport)
      );
      try {
        await act(hook.result.current.start);
        expect(hook.result.current.canCancel).toBe(true);
        retained = false;
        await act(hook.result.current.cancel);
        expect(hook.result.current.state).toStrictEqual({
          _tag: "OutcomeUnavailable",
        });
        expect(hook.result.current.canStart).toBe(true);
        expect(hook.result.current.canCancel).toBe(false);
      } finally {
        hook.unmount();
        await application.queryClient.cancelQueries();
        application.queryClient.clear();
      }
    }
  );

  it("stops waiting for readiness when a query settles during a status request", async () => {
    const result = Deferred.makeUnsafe<string>();
    const { application, statusSignals } = makeApplication({
      slowResult: Deferred.await(result),
      readStatus: (status) =>
        status.started === 0 ? Effect.succeed(status) : Effect.never,
    });
    const hook = renderHook(() => useSlowQueryCancellation(application));
    try {
      const { start } = hook.result.current;
      await act(async () => {
        const starting = start();
        await waitFor(() => {
          expect(statusSignals).toHaveLength(2);
        });
        await Effect.runPromise(Deferred.succeed(result, "completed"));
        await starting;
      });
      expect(statusSignals[1]?.aborted).toBe(true);
      expect(hook.result.current.state).toStrictEqual({ _tag: "Completed" });
    } finally {
      hook.unmount();
      await application.queryClient.cancelQueries();
      application.queryClient.clear();
    }
  });

  it.each(["rpc", "http"] as const)(
    "unmounting one %s hook interrupts only its operation",
    async (transport) => {
      const { application, operations } = makeApplication();
      const first = renderHook(() =>
        useSlowQueryCancellation(application, transport)
      );
      const second = renderHook(() =>
        useSlowQueryCancellation(application, transport)
      );
      try {
        await act(async () => {
          await Promise.all([
            first.result.current.start(),
            second.result.current.start(),
          ]);
        });
        expect({
          firstCancelable: first.result.current.canCancel,
          secondCancelable: second.result.current.canCancel,
          operations: operations.size,
        }).toStrictEqual({
          firstCancelable: true,
          secondCancelable: true,
          operations: 2,
        });

        first.unmount();
        await waitFor(() => {
          expect(
            [...operations.values()].filter(
              ({ interrupted }) => interrupted === 1
            )
          ).toHaveLength(1);
        });
        expect({
          fetching: application.queryClient.isFetching(),
          canCancel: second.result.current.canCancel,
        }).toStrictEqual({ fetching: 1, canCancel: true });

        await act(async () => {
          await second.result.current.cancel();
        });
        expect({
          state: second.result.current.state,
          fetching: application.queryClient.isFetching(),
        }).toStrictEqual({
          state: { _tag: "Cancelled", interruptions: 1 },
          fetching: 0,
        });
      } finally {
        first.unmount();
        second.unmount();
        await application.queryClient.cancelQueries();
        application.queryClient.clear();
      }
    }
  );

  it.each(["rpc", "http"] as const)(
    "unmounting during the initial %s status request stops the request and prevents a slow query",
    async (transport) => {
      const { application, operations, statusSignals } = makeApplication({
        readStatus: () => Effect.never,
      });
      const hook = renderHook(() =>
        useSlowQueryCancellation(application, transport)
      );
      let starting: Promise<void> | undefined;
      try {
        act(() => {
          starting = hook.result.current.start();
        });
        await waitFor(() => {
          expect(statusSignals).toHaveLength(1);
        });
        hook.unmount();
        await starting;
        expect(statusSignals[0]?.aborted).toBe(true);
        expect(operations.size).toBe(0);
        expect(application.queryClient.isFetching()).toBe(0);
      } finally {
        hook.unmount();
        await application.queryClient.cancelQueries();
        application.queryClient.clear();
      }
    }
  );

  it("does not publish a completed status request or poll again after its owner retires", async () => {
    let active = true;
    let statusReads = 0;
    const release = Deferred.makeUnsafe<DiagnosticOperationStatus>();
    const { application, operations } = makeApplication({
      isActive: () => active,
      readStatus: (status) => {
        statusReads += 1;
        return statusReads === 1
          ? Effect.succeed(status)
          : Deferred.await(release);
      },
    });
    const hook = renderHook(() => useSlowQueryCancellation(application));
    let starting: Promise<void> | undefined;
    try {
      act(() => {
        starting = hook.result.current.start();
      });
      await waitFor(() => {
        expect(statusReads).toBe(2);
      });
      active = false;
      await act(async () => {
        await Effect.runPromise(
          Deferred.succeed(release, {
            started: 1,
            interrupted: 0,
            completed: 0,
          })
        );
        await starting;
      });
      expect(hook.result.current.canCancel).toBe(false);
      expect(hook.result.current.state).toStrictEqual({ _tag: "Starting" });
      await act(async () => {
        await hook.result.current.start();
        await hook.result.current.cancel();
      });
      expect(statusReads).toBe(2);
      expect(operations.size).toBe(1);
    } finally {
      hook.unmount();
      await application.queryClient.cancelQueries();
      application.queryClient.clear();
    }
  });
});
