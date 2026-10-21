import type { DiagnosticStatus } from "@effect-api-query/contracts";
import type {
  QueryClient,
  QueryFunction,
  QueryKey,
  SkipToken,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

export interface DiagnosticQuery<Input, Data> {
  readonly queryKey: (input: Input) => QueryKey;
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

export interface SlowQueryApplication {
  readonly queryClient: QueryClient;
  readonly rpcQuery: {
    readonly diagnostics: {
      readonly slow: DiagnosticQuery<SlowInput, string>;
      readonly operationStatus: DiagnosticQuery<StatusInput, DiagnosticStatus>;
    };
  };
  readonly httpQuery: {
    readonly diagnostics: {
      readonly slow: DiagnosticQuery<{ readonly query: SlowInput }, string>;
      readonly operationStatus: DiagnosticQuery<
        { readonly params: StatusInput },
        DiagnosticStatus
      >;
    };
  };
  readonly isActive?: () => boolean;
}

export type SlowQueryCancellationState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Starting" }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Cancelling" }
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
  // oxlint-disable-next-line unicorn/no-useless-undefined
  const baseline = useRef<DiagnosticStatus | undefined>(undefined);
  // oxlint-disable-next-line react/hook-use-state
  const [slowInput] = useState(() => ({
    durationMs: 60_000,
    operationId: globalThis.crypto.randomUUID(),
  }));
  const lifetime = useRef<AbortController | null>(null);
  const adapter = useMemo(
    () =>
      transport === "http"
        ? {
            key: httpQuery.diagnostics.slow.queryKey({ query: slowInput }),
            statusKey: httpQuery.diagnostics.operationStatus.queryKey({
              params: { operationId: slowInput.operationId },
            }),
            run: async () =>
              await queryClient.query(
                httpQuery.diagnostics.slow.queryOptions({
                  input: { query: slowInput },
                })
              ),
            readStatus: async () =>
              await queryClient.query({
                ...httpQuery.diagnostics.operationStatus.queryOptions({
                  input: { params: { operationId: slowInput.operationId } },
                }),
                staleTime: 0,
              }),
          }
        : {
            key: rpcQuery.diagnostics.slow.queryKey(slowInput),
            statusKey: rpcQuery.diagnostics.operationStatus.queryKey({
              operationId: slowInput.operationId,
            }),
            run: async () =>
              await queryClient.query(
                rpcQuery.diagnostics.slow.queryOptions({ input: slowInput })
              ),
            readStatus: async () =>
              await queryClient.query({
                ...rpcQuery.diagnostics.operationStatus.queryOptions({
                  input: { operationId: slowInput.operationId },
                }),
                staleTime: 0,
              }),
          },
    [httpQuery, queryClient, rpcQuery, slowInput, transport]
  );

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    baseline.current = undefined;
    return () => {
      controller.abort();
      void queryClient.cancelQueries({ queryKey: adapter.key, exact: true });
      void queryClient.cancelQueries({
        queryKey: adapter.statusKey,
        exact: true,
      });
    };
  }, [adapter, queryClient]);

  const assertActive = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!isActive()) {
      throw new Error("Owner is inactive");
    }
  };

  const waitForStatus = async (
    predicate: (status: DiagnosticStatus) => boolean,
    signal: AbortSignal
  ): Promise<DiagnosticStatus> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      assertActive(signal);
      // oxlint-disable-next-line eslint/no-await-in-loop
      const status = await adapter.readStatus();
      assertActive(signal);
      if (predicate(status)) {
        return status;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop
      await delay(10);
    }
    throw new Error("Timed out waiting for diagnostic status");
  };

  const runQuery = async () => {
    try {
      await adapter.run();
    } catch {
      // oxlint-disable-next-line eslint/no-useless-return
      return;
    }
  };

  const start = async () => {
    const signal = lifetime.current?.signal;
    if (signal === undefined || signal.aborted || !isActive()) {
      return;
    }
    setState({ _tag: "Starting" });
    try {
      const before = await adapter.readStatus();
      assertActive(signal);
      baseline.current = before;
      void runQuery();
      await waitForStatus(({ started }) => started > before.started, signal);
      assertActive(signal);
      setState({ _tag: "Ready" });
    } catch (error) {
      if (!signal.aborted && isActive()) {
        setState({ _tag: "Failed", error });
      }
    }
  };

  const cancel = async () => {
    const before = baseline.current;
    const signal = lifetime.current?.signal;
    if (
      before === undefined ||
      signal === undefined ||
      signal.aborted ||
      !isActive()
    ) {
      return;
    }

    setState({ _tag: "Cancelling" });
    try {
      await queryClient.cancelQueries({ queryKey: adapter.key, exact: true });
      assertActive(signal);
      const status = await waitForStatus(
        ({ interrupted }) => interrupted > before.interrupted,
        signal
      );
      assertActive(signal);
      setState({ _tag: "Cancelled", interruptions: status.interrupted });
    } catch (error) {
      if (!signal.aborted && isActive()) {
        setState({ _tag: "Failed", error });
      }
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
