import {
  DiagnosticDuration,
  DiagnosticFailure,
  InvalidOperationInput,
  maxDiagnosticDurationMs,
  OperationCapacityExceeded,
  OperationNotFound,
} from "@effect-api-query/contracts";
import type {
  DiagnosticOperationStatus,
  DiagnosticStatus,
  SlowDiagnosticInput,
} from "@effect-api-query/contracts";
import { Deferred, Effect, Exit, Schema } from "effect";

import { requireOperationOwner, requireOperationOwnerFor } from "./caller.ts";
import {
  makeOperationAdmission,
  operationKey,
  retainRecentEntry,
} from "./operation-limits.ts";

interface DiagnosticOperation {
  status: DiagnosticOperationStatus;
  readonly active: Set<Deferred.Deferred<void>>;
}

interface DiagnosticOwner {
  total: DiagnosticStatus;
  readonly operations: Map<string, DiagnosticOperation>;
}

const initialStatus = (): DiagnosticStatus => ({ interrupted: 0, started: 0 });
const validDuration = Schema.is(DiagnosticDuration);

const signalCancellation = (active: readonly Deferred.Deferred<void>[]) =>
  // oxlint-disable-next-line unicorn/no-array-method-this-argument
  Effect.forEach(
    active,
    (cancellation) => Deferred.done(cancellation, Exit.void),
    { discard: true }
  );

export const makeDiagnosticOperations = Effect.sync(() => {
  const admission = makeOperationAdmission();
  const owners = new Map<string, DiagnosticOwner>();
  const retainedOperations = new Map<string, DiagnosticOperationStatus>();
  const retainedTotals = new Map<string, DiagnosticStatus>();

  const operationStatus = Effect.fn("ExampleDiagnostics.operationStatus")(
    function* (operationId: string) {
      const owner = yield* requireOperationOwnerFor(operationId);
      const status =
        owners.get(owner)?.operations.get(operationId)?.status ??
        retainedOperations.get(operationKey(owner, operationId));
      return status ?? (yield* Effect.fail(OperationNotFound.literal));
    }
  );

  const status = Effect.gen(function* () {
    const owner = yield* requireOperationOwner;
    return (
      owners.get(owner)?.total ?? retainedTotals.get(owner) ?? initialStatus()
    );
  });

  const cancel = Effect.fn("ExampleRpc.DiagnosticOperations.cancel")(function* (
    operationId: string
  ) {
    const owner = yield* requireOperationOwnerFor(operationId);
    const operation = owners.get(owner)?.operations.get(operationId);
    if (operation !== undefined) {
      return yield* signalCancellation([...operation.active]);
    }
    if (!retainedOperations.has(operationKey(owner, operationId))) {
      return yield* Effect.fail(OperationNotFound.literal);
    }
    return yield* Effect.void;
  });

  const reset = Effect.suspend(() => {
    const active = [...owners.values()].flatMap(({ operations }) =>
      [...operations.values()].flatMap((operation) => [...operation.active])
    );
    owners.clear();
    retainedOperations.clear();
    retainedTotals.clear();
    return signalCancellation(active);
  }).pipe(Effect.uninterruptible);

  const slow = Effect.fn("ExampleRpc.diagnostics.slow")(function* ({
    durationMs = maxDiagnosticDurationMs,
    operationId = "anonymous",
  }: SlowDiagnosticInput) {
    const owner = yield* requireOperationOwnerFor(operationId);
    if (!validDuration(durationMs)) {
      return yield* Effect.fail(InvalidOperationInput.literal);
    }

    const key = operationKey(owner, operationId);
    return yield* Effect.acquireUseRelease(
      Effect.suspend(() => {
        if (!admission.tryAcquire(owner)) {
          return Effect.fail(OperationCapacityExceeded.literal);
        }
        const state = owners.get(owner) ?? {
          total: retainedTotals.get(owner) ?? initialStatus(),
          operations: new Map<string, DiagnosticOperation>(),
        };
        const operation = state.operations.get(operationId) ?? {
          status: retainedOperations.get(key) ?? {
            ...initialStatus(),
            completed: 0,
          },
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
        retainedOperations.delete(key);
        retainedTotals.delete(owner);
        return Effect.succeed({ state, operation, cancellation });
      }),
      ({ cancellation }) =>
        Deferred.await(cancellation).pipe(
          Effect.andThen(Effect.interrupt),
          Effect.timeoutOrElse({
            duration: durationMs,
            orElse: () => Effect.succeed("completed"),
          })
        ),
      ({ state, operation, cancellation }, exit) =>
        Effect.sync(() => {
          operation.active.delete(cancellation);
          admission.release(owner);
          if (owners.get(owner) !== state) {
            return;
          }
          if (Exit.isSuccess(exit)) {
            operation.status = {
              ...operation.status,
              completed: operation.status.completed + 1,
            };
          }
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
          if (operation.active.size === 0) {
            state.operations.delete(operationId);
            retainRecentEntry(retainedOperations, key, operation.status);
          }
          if (state.operations.size === 0) {
            owners.delete(owner);
            retainRecentEntry(retainedTotals, owner, state.total);
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
