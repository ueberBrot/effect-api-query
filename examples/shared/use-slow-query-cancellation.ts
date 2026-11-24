import type { DiagnosticOperationStatus } from "@effect-api-query/contracts";
import type {
  QueryClient,
  QueryFunction,
  QueryKey,
  SkipToken,
} from "@tanstack/react-query";
import { CancelledError } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { isOperationNotFound } from "./operation-errors.ts";

export interface DiagnosticQuery<Input, Data> {
  readonly queryOptions: (options: { readonly input: Input }) => {
    readonly queryKey: QueryKey;
    readonly queryFn: QueryFunction<Data> | SkipToken;
  };
}

export interface SlowInput {
  readonly durationMs: number;
  readonly operationId: string;
}
export interface StatusInput {
  readonly operationId: string;
}

export interface DiagnosticStatusCall<Input> {
  readonly call: (options: {
    readonly input: Input;
    readonly signal: AbortSignal;
  }) => Promise<DiagnosticOperationStatus>;
}

export interface SlowQueryApplication {
  readonly queryClient: QueryClient;
  readonly rpcQuery: {
    readonly diagnostics: {
      readonly slow: DiagnosticQuery<SlowInput, string>;
      readonly operationStatus: DiagnosticStatusCall<StatusInput>;
    };
  };
  readonly httpQuery: {
    readonly diagnostics: {
      readonly slow: DiagnosticQuery<{ readonly query: SlowInput }, string>;
      readonly operationStatus: DiagnosticStatusCall<{
        readonly params: StatusInput;
      }>;
    };
  };
  readonly isActive?: () => boolean;
}

export type SlowQueryCancellationState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Starting" }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Cancelling" }
  | { readonly _tag: "Completed" }
  | { readonly _tag: "Cancelled"; readonly interruptions: number }
  | { readonly _tag: "Failed"; readonly error: unknown };

export const describeSlowQueryCancellation = (
  state: SlowQueryCancellationState
): string | undefined => {
  switch (state._tag) {
    case "Idle": {
      return undefined;
    }
    case "Starting": {
      return "Starting query…";
    }
    case "Ready": {
      return "Ready to cancel";
    }
    case "Cancelling": {
      return "Cancelling query…";
    }
    case "Completed": {
      return "Slow query completed";
    }
    case "Cancelled": {
      return `Server interruptions: ${String(state.interruptions)}`;
    }
    case "Failed": {
      return "Slow query failed";
    }
    default: {
      throw new Error("Unknown slow query cancellation state");
    }
  }
};

const delay = async (milliseconds: number) => {
  // oxlint-disable-next-line promise/avoid-new
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
};

const readBaseline = async (
  readStatus: (signal: AbortSignal) => Promise<DiagnosticOperationStatus>,
  signal: AbortSignal
): Promise<DiagnosticOperationStatus> => {
  try {
    return await readStatus(signal);
  } catch (error) {
    if (isOperationNotFound(error)) {
      return { started: 0, interrupted: 0, completed: 0 };
    }
    throw error;
  }
};

const makeSlowQuery = (
  { rpcQuery, httpQuery }: Pick<SlowQueryApplication, "rpcQuery" | "httpQuery">,
  transport: "rpc" | "http"
) => {
  const operationId = globalThis.crypto.randomUUID();
  const input = { durationMs: 60_000, operationId };
  return transport === "http"
    ? {
        options: httpQuery.diagnostics.slow.queryOptions({
          input: { query: input },
        }),
        readStatus: async (signal: AbortSignal) =>
          await httpQuery.diagnostics.operationStatus.call({
            input: { params: { operationId } },
            signal,
          }),
      }
    : {
        options: rpcQuery.diagnostics.slow.queryOptions({ input }),
        readStatus: async (signal: AbortSignal) =>
          await rpcQuery.diagnostics.operationStatus.call({
            input: { operationId },
            signal,
          }),
      };
};

interface SlowQueryRun {
  readonly controller: AbortController;
  readonly queryKey: QueryKey;
  phase:
    | { readonly _tag: "Starting" }
    | { readonly _tag: "Ready"; readonly before: DiagnosticOperationStatus }
    | { readonly _tag: "Cancelling" };
  readonly readStatus: (
    signal: AbortSignal
  ) => Promise<DiagnosticOperationStatus>;
}

const alwaysActive = () => true;

export const useSlowQueryCancellation = (
  {
    queryClient,
    rpcQuery,
    httpQuery,
    isActive = alwaysActive,
  }: SlowQueryApplication,
  transport: "rpc" | "http" = "rpc"
) => {
  const [state, setState] = useState<SlowQueryCancellationState>({
    _tag: "Idle",
  });
  const mounted = useRef(false);
  const current = useRef<SlowQueryRun | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const run = current.current;
      current.current = null;
      if (run !== null) {
        run.controller.abort();
        void queryClient.cancelQueries({ queryKey: run.queryKey, exact: true });
      }
    };
  }, [queryClient]);

  const assertActive = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!isActive()) {
      throw new Error("Owner is inactive");
    }
  };

  const waitForStatus = async (
    { controller: { signal }, readStatus }: SlowQueryRun,
    predicate: (status: DiagnosticOperationStatus) => boolean,
    allowMissing = false
  ): Promise<DiagnosticOperationStatus> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      assertActive(signal);
      // oxlint-disable-next-line eslint/no-await-in-loop
      const status = await (allowMissing
        ? readBaseline(readStatus, signal)
        : readStatus(signal));
      assertActive(signal);
      if (predicate(status)) {
        return status;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop
      await delay(10);
    }
    throw new Error("Timed out waiting for diagnostic status");
  };

  const finish = (run: SlowQueryRun, next: SlowQueryCancellationState) => {
    if (current.current !== run) {
      return;
    }
    current.current = null;
    run.controller.abort();
    if (isActive()) {
      setState(next);
    }
  };

  const start = async () => {
    if (!mounted.current || current.current !== null || !isActive()) {
      return;
    }
    const { options, readStatus } = makeSlowQuery(
      { rpcQuery, httpQuery },
      transport
    );
    const run: SlowQueryRun = {
      controller: new AbortController(),
      queryKey: options.queryKey,
      phase: { _tag: "Starting" },
      readStatus,
    };
    const { signal } = run.controller;
    const trackSettlement = async () => {
      try {
        await queryClient.query(options);
        finish(run, { _tag: "Completed" });
      } catch (error) {
        if (
          run.phase._tag !== "Cancelling" ||
          !(error instanceof CancelledError)
        ) {
          finish(run, { _tag: "Failed", error });
        }
      }
    };
    current.current = run;
    setState({ _tag: "Starting" });
    try {
      const before = await readBaseline(readStatus, signal);
      assertActive(signal);
      void trackSettlement();
      await waitForStatus(run, ({ started }) => started > before.started, true);
      assertActive(signal);
      run.phase = { _tag: "Ready", before };
      setState({ _tag: "Ready" });
    } catch (error) {
      if (current.current === run) {
        finish(run, { _tag: "Failed", error });
        await queryClient.cancelQueries({
          queryKey: run.queryKey,
          exact: true,
        });
      }
    }
  };

  const cancel = async () => {
    const run = current.current;
    if (run?.phase._tag !== "Ready" || !isActive()) {
      return;
    }
    const { before } = run.phase;
    run.phase = { _tag: "Cancelling" };
    setState({ _tag: "Cancelling" });
    try {
      await queryClient.cancelQueries({ queryKey: run.queryKey, exact: true });
      const status = await waitForStatus(
        run,
        ({ completed, interrupted }) =>
          completed > before.completed || interrupted > before.interrupted
      );
      finish(
        run,
        status.interrupted > before.interrupted
          ? { _tag: "Cancelled", interruptions: status.interrupted }
          : { _tag: "Completed" }
      );
    } catch (error) {
      finish(run, { _tag: "Failed", error });
    }
  };

  return {
    cancel,
    canCancel: state._tag === "Ready",
    canStart: !["Cancelling", "Ready", "Starting"].includes(state._tag),
    start,
    state,
  } as const;
};
