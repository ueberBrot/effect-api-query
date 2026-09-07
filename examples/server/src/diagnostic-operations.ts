import type { DiagnosticStatus, SlowDiagnosticInput } from '@effect-api-query/contracts'
import { Deferred, Effect, Ref } from 'effect'

const initialStatus = (): DiagnosticStatus => ({ interrupted: 0, started: 0 })

export const makeDiagnosticOperations = Effect.fn('ExampleRpc.makeDiagnosticOperations')(
  function* () {
    const status = yield* Ref.make(initialStatus())
    const active = new Map<string, Set<Deferred.Deferred<void>>>()

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
      ).pipe(Effect.andThen(Ref.set(status, initialStatus())))
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
      yield* Ref.update(status, (current) => ({
        ...current,
        started: current.started + 1,
      }))

      return yield* Effect.raceFirst(
        Effect.sleep(durationMs ?? 60_000).pipe(Effect.as('completed')),
        Deferred.await(cancellation).pipe(Effect.andThen(Effect.interrupt)),
      ).pipe(
        Effect.onInterrupt(() =>
          remove(id, cancellation).pipe(
            Effect.flatMap((removed) =>
              removed
                ? Ref.update(status, (current) => ({
                    ...current,
                    interrupted: current.interrupted + 1,
                  }))
                : Effect.void,
            ),
          ),
        ),
        Effect.ensuring(remove(id, cancellation)),
      )
    })

    return {
      cancel,
      reset,
      slow,
      status: Ref.get(status),
    } as const
  },
)
