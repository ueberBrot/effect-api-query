import { DiagnosticFailure } from "@effect-api-query/contracts";
import type {
  DiagnosticStatus,
  SlowDiagnosticInput,
} from "@effect-api-query/contracts";
import { Deferred, Effect, Exit } from "effect";

import { requireOperationOwner } from "./caller.ts";

interface DiagnosticOperation {
  status: DiagnosticStatus;
  readonly active: Set<Deferred.Deferred<void>>;
}

const initialStatus = (): DiagnosticStatus => ({ interrupted: 0, started: 0 });

export const makeDiagnosticOperations = Effect.sync(() => {
  const owners = new Map<
    string,
    {
      total: DiagnosticStatus;
      readonly operations: Map<string, DiagnosticOperation>;
    }
  >();

  const operationStatus = Effect.fn("ExampleDiagnostics.operationStatus")(
    function* (operationId: string) {
      const owner = yield* requireOperationOwner;
      const operation = owners.get(owner)?.operations.get(operationId);
      return operation === undefined
        ? yield* Effect.fail("operation-not-found" as const)
        : operation.status;
    }
  );

  const status = Effect.gen(function* () {
    const owner = yield* requireOperationOwner;
    return owners.get(owner)?.total ?? initialStatus();
  });

  const cancel = Effect.fn("ExampleRpc.DiagnosticOperations.cancel")(function* (
    operationId: string
  ) {
    const owner = yield* requireOperationOwner;
    const operation = owners.get(owner)?.operations.get(operationId);
    if (operation === undefined) {
      return yield* Effect.fail("operation-not-found" as const);
    }
    // oxlint-disable-next-line unicorn/no-array-method-this-argument
    return yield* Effect.forEach(
      [...operation.active],
      (cancellation) => Deferred.done(cancellation, Exit.void),
      { discard: true }
    );
  });

  const reset = Effect.suspend(() => {
    const active = [...owners.values()].flatMap(({ operations }) =>
      [...operations.values()].flatMap((operation) => [...operation.active])
    );
    owners.clear();
    // oxlint-disable-next-line unicorn/no-array-method-this-argument
    return Effect.forEach(
      active,
      (cancellation) => Deferred.done(cancellation, Exit.void),
      { discard: true }
    );
  });

  const slow = Effect.fn("ExampleRpc.diagnostics.slow")(function* ({
    durationMs,
    operationId = "anonymous",
  }: SlowDiagnosticInput) {
    const owner = yield* requireOperationOwner;
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const state = owners.get(owner) ?? {
          total: initialStatus(),
          operations: new Map<string, DiagnosticOperation>(),
        };
        const operation = state.operations.get(operationId) ?? {
          status: initialStatus(),
          active: new Set<Deferred.Deferred<void>>(),
        };
        // oxlint-disable-next-line typescript/no-invalid-void-type
        const cancellation = Deferred.makeUnsafe<void>();
        operation.active.add(cancellation);
        operation.status = {
          ...operation.status,
          started: operation.status.started + 1,
        };
        state.total = { ...state.total, started: state.total.started + 1 };
        state.operations.set(operationId, operation);
        owners.set(owner, state);
        return { state, operation, cancellation };
      }),
      ({ cancellation }) =>
        Deferred.await(cancellation).pipe(
          Effect.andThen(Effect.interrupt),
          Effect.timeoutOrElse({
            duration: durationMs ?? 60_000,
            orElse: () => Effect.succeed("completed"),
          })
        ),
      ({ state, operation, cancellation }, exit) =>
        Effect.sync(() => {
          operation.active.delete(cancellation);
          if (Exit.hasInterrupts(exit)) {
            operation.status = {
              ...operation.status,
              interrupted: operation.status.interrupted + 1,
            };
            state.total = {
              ...state.total,
              interrupted: state.total.interrupted + 1,
            };
          }
        })
    );
  });

  return {
    cancel,
    fail: Effect.fail(new DiagnosticFailure({ reason: "requested-failure" })),
    operationStatus,
    reset,
    slow,
    status,
  } as const;
});
