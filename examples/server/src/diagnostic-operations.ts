import { DiagnosticFailure } from "@effect-api-query/contracts";
import type {
  DiagnosticStatus,
  SlowDiagnosticInput,
} from "@effect-api-query/contracts";
import { Deferred, Effect, Exit, HashMap, Option, Ref } from "effect";

const initialStatus = (): DiagnosticStatus => ({ interrupted: 0, started: 0 });

const initialState = () => ({
  total: initialStatus(),
  operations: HashMap.empty<string, DiagnosticStatus>(),
});

export const makeDiagnosticOperations = Effect.fn(
  "ExampleRpc.makeDiagnosticOperations"
)(function* () {
  const state = yield* Ref.make(initialState());
  const active = new Map<string, Set<Deferred.Deferred<void>>>();

  const record = Effect.fn("ExampleDiagnostics.record")(
    (operationId: string, event: keyof DiagnosticStatus) =>
      Ref.update(state, (current) => {
        const previous = Option.getOrElse(
          HashMap.get(current.operations, operationId),
          initialStatus
        );
        return {
          total: { ...current.total, [event]: current.total[event] + 1 },
          operations: HashMap.set(current.operations, operationId, {
            ...previous,
            [event]: previous[event] + 1,
          }),
        };
      })
  );

  const remove = Effect.fn("ExampleRpc.DiagnosticOperations.remove")(
    (operationId: string, cancellation: Deferred.Deferred<void>) =>
      Effect.sync(() => {
        const operations = active.get(operationId);
        if (operations === undefined || !operations.delete(cancellation)) {
          return false;
        }
        if (operations.size === 0) {
          active.delete(operationId);
        }
        return true;
      })
  );

  const cancel = Effect.fn("ExampleRpc.DiagnosticOperations.cancel")(
    (operationId: string) =>
      Effect.suspend(() => {
        const operations = active.get(operationId);
        if (operations === undefined) {
          return Effect.void;
        }
        // oxlint-disable-next-line unicorn/no-array-method-this-argument
        return Effect.forEach(operations, (cancellation) =>
          Deferred.done(cancellation, Exit.void)
        ).pipe(Effect.asVoid);
      })
  );

  const reset = Effect.suspend(() => {
    const cancellations = [...active.values()].flatMap((operations) => [
      ...operations,
    ]);
    active.clear();
    // oxlint-disable-next-line unicorn/no-array-method-this-argument
    return Effect.forEach(cancellations, (cancellation) =>
      Deferred.done(cancellation, Exit.void)
    ).pipe(Effect.andThen(Ref.set(state, initialState())));
  });

  const slow = Effect.fn("ExampleRpc.diagnostics.slow")(function* ({
    durationMs,
    operationId,
  }: SlowDiagnosticInput) {
    const id = operationId ?? "anonymous";
    // oxlint-disable-next-line typescript/no-invalid-void-type
    const cancellation = yield* Deferred.make<void>();
    const operations = active.get(id) ?? new Set<Deferred.Deferred<void>>();
    operations.add(cancellation);
    active.set(id, operations);
    yield* record(id, "started");

    return yield* Deferred.await(cancellation).pipe(
      Effect.andThen(Effect.interrupt),
      Effect.timeoutOrElse({
        duration: durationMs ?? 60_000,
        orElse: () => Effect.succeed("completed"),
      }),
      Effect.onInterrupt(() =>
        remove(id, cancellation).pipe(
          Effect.flatMap((removed) =>
            removed ? record(id, "interrupted") : Effect.void
          )
        )
      ),
      Effect.ensuring(remove(id, cancellation))
    );
  });

  return {
    cancel,
    fail: Effect.fail(new DiagnosticFailure({ reason: "requested-failure" })),
    operationStatus: Effect.fn("ExampleDiagnostics.operationStatus")(
      (operationId: string) =>
        Ref.get(state).pipe(
          Effect.map((current) =>
            Option.getOrElse(
              HashMap.get(current.operations, operationId),
              initialStatus
            )
          )
        )
    ),
    reset,
    slow,
    status: Ref.get(state).pipe(Effect.map((current) => current.total)),
  } as const;
});
