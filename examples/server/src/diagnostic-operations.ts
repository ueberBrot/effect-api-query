import {
  DiagnosticFailure,
  type DiagnosticStatus,
  type SlowDiagnosticInput,
} from '@effect-api-query/contracts'
import { Deferred, Effect, Ref } from 'effect'

const initialStatus = (): DiagnosticStatus => ({ interrupted: 0, started: 0 })

const initialState = () => ({
  total: initialStatus(),
  operations: new Map<string, DiagnosticStatus>(),
})

export const makeDiagnosticOperations = Effect.fn('ExampleRpc.makeDiagnosticOperations')(
  function* () {
    const state = yield* Ref.make(initialState())
    const active = new Map<string, Set<Deferred.Deferred<void>>>()

    const record = Effect.fn('ExampleDiagnostics.record')(
      (operationId: string, event: keyof DiagnosticStatus) =>
        Ref.update(state, (current) => {
          const previous = current.operations.get(operationId) ?? initialStatus()
          return {
            total: { ...current.total, [event]: current.total[event] + 1 },
            operations: new Map(current.operations).set(operationId, {
              ...previous,
              [event]: previous[event] + 1,
            }),
          }
        }),
    )

    const remove = Effect.fn('ExampleRpc.DiagnosticOperations.remove')(
      (operationId: string, cancellation: Deferred.Deferred<void>) =>
        Effect.sync(() => {
          const operations = active.get(operationId)
          if (operations === undefined || !operations.delete(cancellation)) return false
          if (operations.size === 0) active.delete(operationId)
          return true
        }),
    )

    const cancel = Effect.fn('ExampleRpc.DiagnosticOperations.cancel')((operationId: string) =>
      Effect.suspend(() => {
        const operations = active.get(operationId)
        return operations === undefined
          ? Effect.void
          : Effect.forEach(operations, (cancellation) =>
              Deferred.succeed(cancellation, undefined),
            ).pipe(Effect.asVoid)
      }),
    )

    const reset = Effect.suspend(() => {
      const cancellations = Array.from(active.values()).flatMap((operations) =>
        Array.from(operations),
      )
      active.clear()
      return Effect.forEach(cancellations, (cancellation) =>
        Deferred.succeed(cancellation, undefined),
      ).pipe(Effect.andThen(Ref.set(state, initialState())))
    })

    const slow = Effect.fn('ExampleRpc.diagnostics.slow')(function* ({
      durationMs,
      operationId,
    }: SlowDiagnosticInput) {
      const id = operationId ?? 'anonymous'
      const cancellation = yield* Deferred.make<void>()
      const operations = active.get(id) ?? new Set<Deferred.Deferred<void>>()
      operations.add(cancellation)
      active.set(id, operations)
      yield* record(id, 'started')

      return yield* Effect.raceFirst(
        Effect.sleep(durationMs ?? 60_000).pipe(Effect.as('completed')),
        Deferred.await(cancellation).pipe(Effect.andThen(Effect.interrupt)),
      ).pipe(
        Effect.onInterrupt(() =>
          remove(id, cancellation).pipe(
            Effect.flatMap((removed) => (removed ? record(id, 'interrupted') : Effect.void)),
          ),
        ),
        Effect.ensuring(remove(id, cancellation)),
      )
    })

    return {
      cancel,
      fail: Effect.fail(new DiagnosticFailure({ reason: 'requested-failure' })),
      operationStatus: Effect.fn('ExampleDiagnostics.operationStatus')((operationId: string) =>
        Ref.get(state).pipe(
          Effect.map((current) => current.operations.get(operationId) ?? initialStatus()),
        ),
      ),
      reset,
      slow,
      status: Ref.get(state).pipe(Effect.map((current) => current.total)),
    } as const
  },
)
