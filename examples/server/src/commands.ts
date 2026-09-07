import { type CommandPayload, CommandStatus } from '@effect-api-query/contracts'
import { Deferred, Effect, Scope } from 'effect'

interface Command {
  status: CommandStatus
  readonly cancellation: Deferred.Deferred<void>
  readonly done: Deferred.Deferred<CommandStatus>
}

export const makeCommands = Effect.fn('ExampleRpc.makeCommands')(function* () {
  const scope = yield* Scope.Scope
  const commands = new Map<string, Command>()

  const finish = Effect.fn('ExampleRpc.Commands.finish')(function* (
    command: Command,
    state: 'completed' | 'cancelled',
  ) {
    command.status = new CommandStatus({
      operationId: command.status.operationId,
      completedSteps: command.status.completedSteps,
      totalSteps: command.status.totalSteps,
      state,
    })
    yield* Deferred.succeed(command.done, command.status)
  })

  const work = Effect.fn('ExampleRpc.Commands.work')(
    function* (command: Command) {
      for (let step = 0; step < command.status.totalSteps; step += 1) {
        const cancelled = yield* Effect.raceFirst(
          Effect.sleep('100 millis').pipe(Effect.as(false)),
          Deferred.await(command.cancellation).pipe(Effect.as(true)),
        )
        if (cancelled) return yield* finish(command, 'cancelled')
        command.status = new CommandStatus({
          operationId: command.status.operationId,
          state: command.status.state,
          totalSteps: command.status.totalSteps,
          completedSteps: step + 1,
        })
      }
      yield* finish(command, 'completed')
    },
    (effect, command) => effect.pipe(Effect.onInterrupt(() => finish(command, 'cancelled'))),
  )

  // Reserve the ID and attach its worker atomically with respect to interruption.
  const getOrCreate = Effect.fn('ExampleRpc.Commands.getOrCreate')(function* (
    operationId: string,
    steps: number,
  ) {
    const existing = commands.get(operationId)
    if (existing !== undefined) return existing
    const command: Command = {
      status: new CommandStatus({
        operationId,
        state: steps === 0 ? 'cancelled' : 'running',
        completedSteps: 0,
        totalSteps: steps,
      }),
      cancellation: Deferred.makeUnsafe<void>(),
      done: Deferred.makeUnsafe<CommandStatus>(),
    }
    commands.set(operationId, command)
    if (steps === 0) {
      // A cancel request may arrive before its start request.
      yield* Deferred.succeed(command.done, command.status)
    } else {
      yield* Effect.forkIn(work(command), scope, { uninterruptible: false })
    }
    return command
  }, Effect.uninterruptible)

  const start = Effect.fn('ExampleRpc.Commands.start')(function* ({
    operationId,
    steps,
  }: CommandPayload) {
    const command = yield* getOrCreate(operationId, steps)
    return yield* Deferred.await(command.done)
  })

  const cancel = Effect.fn('ExampleRpc.Commands.cancel')(function* ({
    operationId,
  }: {
    readonly operationId: string
  }) {
    const command = yield* getOrCreate(operationId, 0)
    yield* Deferred.succeed(command.cancellation, undefined)
    return yield* Deferred.await(command.done)
  })

  const status = Effect.fn('ExampleRpc.Commands.status')(
    ({ operationId }: { readonly operationId: string }) =>
      Effect.sync(() => commands.get(operationId)?.status ?? null),
  )

  const reset = Effect.gen(function* () {
    for (const command of commands.values()) {
      yield* Deferred.succeed(command.cancellation, undefined)
      yield* Deferred.await(command.done)
    }
    commands.clear()
  })

  return { start, cancel, status, reset }
})
