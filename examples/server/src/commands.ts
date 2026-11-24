import { CommandStatus } from "@effect-api-query/contracts";
import type { CommandPayload } from "@effect-api-query/contracts";
import { Deferred, Effect, Exit, Scope } from "effect";

import { requireOperationOwner } from "./caller.ts";

interface Command {
  status: CommandStatus;
  readonly cancellation: Deferred.Deferred<void>;
  readonly done: Deferred.Deferred<CommandStatus>;
}

export const makeCommands = Effect.fn("ExampleRpc.makeCommands")(function* () {
  const scope = yield* Scope.Scope;
  const commands = new Map<string, Command | null>();

  const finish = Effect.fn("ExampleRpc.Commands.finish")(function* (
    command: Command,
    state: "completed" | "cancelled"
  ) {
    command.status = new CommandStatus({
      operationId: command.status.operationId,
      completedSteps: command.status.completedSteps,
      totalSteps: command.status.totalSteps,
      state,
    });
    yield* Deferred.succeed(command.done, command.status);
  });

  const work = Effect.fn("ExampleRpc.Commands.work")(
    function* (command: Command) {
      for (let step = 0; step < command.status.totalSteps; step += 1) {
        const cancelled = yield* Deferred.await(command.cancellation).pipe(
          Effect.as(true),
          Effect.timeoutOrElse({
            duration: "100 millis",
            orElse: () => Effect.succeed(false),
          })
        );
        if (cancelled) {
          yield* finish(command, "cancelled");
          return;
        }
        command.status = new CommandStatus({
          operationId: command.status.operationId,
          state: command.status.state,
          totalSteps: command.status.totalSteps,
          completedSteps: step + 1,
        });
      }
      yield* finish(command, "completed");
    },
    (effect, command) =>
      effect.pipe(Effect.onInterrupt(() => finish(command, "cancelled")))
  );

  const createCommand = (key: string, operationId: string, steps: number) => {
    const command: Command = {
      status: new CommandStatus({
        operationId,
        state: steps === 0 ? "cancelled" : "running",
        completedSteps: 0,
        totalSteps: steps,
      }),
      // oxlint-disable-next-line typescript/no-invalid-void-type
      cancellation: Deferred.makeUnsafe<void>(),
      done: Deferred.makeUnsafe<CommandStatus>(),
    };
    commands.set(key, command);
    return command;
  };

  const reserve = Effect.fn("ExampleRpc.Commands.reserve")(function* ({
    operationId,
  }: {
    readonly operationId: string;
  }) {
    const owner = yield* requireOperationOwner;
    const key = JSON.stringify([owner, operationId]);
    if (!commands.has(key)) {
      commands.set(key, null);
    }
  });

  const startWork = Effect.fn("ExampleRpc.Commands.startWork")(function* (
    key: string,
    operationId: string,
    steps: number
  ) {
    const existing = commands.get(key);
    if (existing !== undefined && existing !== null) {
      return existing;
    }
    const command = createCommand(key, operationId, steps);
    yield* Effect.forkIn(work(command), scope, { uninterruptible: false });
    return command;
  }, Effect.uninterruptible);

  const start = Effect.fn("ExampleRpc.Commands.start")(function* ({
    operationId,
    steps,
  }: CommandPayload) {
    const owner = yield* requireOperationOwner;
    const command = yield* startWork(
      JSON.stringify([owner, operationId]),
      operationId,
      steps
    );
    return yield* Deferred.await(command.done);
  });

  const cancel = Effect.fn("ExampleRpc.Commands.cancel")(function* ({
    operationId,
  }: {
    readonly operationId: string;
  }) {
    const owner = yield* requireOperationOwner;
    const key = JSON.stringify([owner, operationId]);
    const existing = commands.get(key);
    if (existing === undefined) {
      return yield* Effect.fail("operation-not-found" as const);
    }
    if (existing === null) {
      const cancelled = createCommand(key, operationId, 0);
      yield* Deferred.succeed(cancelled.done, cancelled.status);
      return cancelled.status;
    }
    yield* Deferred.done(existing.cancellation, Exit.void);
    return yield* Deferred.await(existing.done);
  }, Effect.uninterruptible);

  const status = Effect.fn("ExampleRpc.Commands.status")(function* ({
    operationId,
  }: {
    readonly operationId: string;
  }) {
    const owner = yield* requireOperationOwner;
    return commands.get(JSON.stringify([owner, operationId]))?.status ?? null;
  });

  const reset = Effect.gen(function* () {
    for (const command of commands.values()) {
      if (command !== null) {
        yield* Deferred.done(command.cancellation, Exit.void);
        yield* Deferred.await(command.done);
      }
    }
    commands.clear();
  });

  return { start, reserve, cancel, status, reset };
});
