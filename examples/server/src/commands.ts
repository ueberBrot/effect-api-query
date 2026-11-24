import {
  CommandStatus,
  CommandSteps,
  InvalidOperationInput,
  OperationCapacityExceeded,
  OperationNotFound,
} from "@effect-api-query/contracts";
import type { CommandPayload } from "@effect-api-query/contracts";
import { Clock, Deferred, Effect, Exit, Schema, Scope } from "effect";

import { requireOperationOwnerFor } from "./caller.ts";
import {
  commandReservationTtlMs,
  makeOperationAdmission,
  maxPendingCommandReservations,
  maxPendingCommandReservationsPerOwner,
  operationKey,
  retainRecentEntry,
} from "./operation-limits.ts";

const validSteps = Schema.is(CommandSteps);

const ownedCommand = Effect.fnUntraced(function* (operationId: string) {
  const owner = yield* requireOperationOwnerFor(operationId);
  return { owner, key: operationKey(owner, operationId) };
});

interface Command {
  status: CommandStatus;
  readonly cancellation: Deferred.Deferred<void>;
  readonly done: Deferred.Deferred<CommandStatus>;
}

interface CommandReservation {
  readonly owner: string;
  readonly expiresAt: number;
  cancelled: CommandStatus | null;
}

export const makeCommands = Effect.fn("ExampleRpc.makeCommands")(function* () {
  const scope = yield* Scope.Scope;
  const clock = yield* Clock.Clock;
  const admission = makeOperationAdmission();
  const running = new Map<string, Command>();
  const reservations = new Map<string, CommandReservation>();
  const history = new Map<string, CommandStatus>();

  const getLiveReservation = (key: string, now: number) => {
    const reservation = reservations.get(key) ?? null;
    if (reservation !== null && reservation.expiresAt <= now) {
      reservations.delete(key);
      return null;
    }
    return reservation;
  };

  const work = Effect.fn("ExampleRpc.Commands.work")(function* (
    command: Command
  ) {
    for (let step = 0; step < command.status.totalSteps; step += 1) {
      const cancelled = yield* Deferred.await(command.cancellation).pipe(
        Effect.as(true),
        Effect.timeoutOrElse({
          duration: "100 millis",
          orElse: () => Effect.succeed(false),
        })
      );
      if (cancelled) {
        return "cancelled" as const;
      }
      command.status = new CommandStatus({
        operationId: command.status.operationId,
        state: "running",
        totalSteps: command.status.totalSteps,
        completedSteps: step + 1,
      });
    }
    return "completed" as const;
  });

  const reserve = Effect.fn("ExampleRpc.Commands.reserve")(function* ({
    operationId,
  }: {
    readonly operationId: string;
  }) {
    const { owner, key } = yield* ownedCommand(operationId);
    const now = clock.currentTimeMillisUnsafe();
    if (
      running.has(key) ||
      history.has(key) ||
      getLiveReservation(key, now) !== null
    ) {
      return yield* Effect.void;
    }

    let ownerReservations = 0;
    for (const reservedKey of reservations.keys()) {
      if (getLiveReservation(reservedKey, now)?.owner === owner) {
        ownerReservations += 1;
      }
    }
    if (
      reservations.size >= maxPendingCommandReservations ||
      ownerReservations >= maxPendingCommandReservationsPerOwner
    ) {
      return yield* Effect.fail(OperationCapacityExceeded.literal);
    }

    reservations.set(key, {
      owner,
      expiresAt: now + commandReservationTtlMs,
      cancelled: null,
    });
    return yield* Effect.void;
  });

  const start = Effect.fn("ExampleRpc.Commands.start")(function* ({
    operationId,
    steps,
  }: CommandPayload) {
    const { owner, key } = yield* ownedCommand(operationId);
    if (!validSteps(steps)) {
      return yield* Effect.fail(InvalidOperationInput.literal);
    }
    const active = running.get(key);
    if (active !== undefined) {
      return yield* Effect.interruptible(Deferred.await(active.done));
    }
    const terminal = history.get(key);
    if (terminal !== undefined) {
      return terminal;
    }
    const cancelled =
      getLiveReservation(key, clock.currentTimeMillisUnsafe())?.cancelled ??
      null;
    if (cancelled !== null) {
      reservations.delete(key);
      retainRecentEntry(history, key, cancelled);
      return cancelled;
    }
    if (!admission.tryAcquire(owner)) {
      return yield* Effect.fail(OperationCapacityExceeded.literal);
    }

    const command: Command = {
      status: new CommandStatus({
        operationId,
        state: "running",
        completedSteps: 0,
        totalSteps: steps,
      }),
      // oxlint-disable-next-line typescript/no-invalid-void-type
      cancellation: Deferred.makeUnsafe<void>(),
      done: Deferred.makeUnsafe<CommandStatus>(),
    };
    reservations.delete(key);
    running.set(key, command);
    const fiber = yield* Effect.forkIn(work(command), scope, {
      uninterruptible: false,
    });
    fiber.addObserver((exit) => {
      const status = new CommandStatus({
        operationId,
        totalSteps: steps,
        completedSteps: command.status.completedSteps,
        state: Exit.isSuccess(exit) ? exit.value : "cancelled",
      });
      running.delete(key);
      admission.release(owner);
      retainRecentEntry(history, key, status);
      Deferred.doneUnsafe(command.done, Effect.succeed(status));
    });

    return yield* Effect.interruptible(Deferred.await(command.done));
  }, Effect.uninterruptible);

  const cancel = Effect.fn("ExampleRpc.Commands.cancel")(function* ({
    operationId,
  }: {
    readonly operationId: string;
  }) {
    const { key } = yield* ownedCommand(operationId);
    const active = running.get(key);
    if (active !== undefined) {
      yield* Deferred.done(active.cancellation, Exit.void);
      return yield* Effect.interruptible(Deferred.await(active.done));
    }
    const terminal = history.get(key);
    if (terminal !== undefined) {
      return terminal;
    }
    const reservation = getLiveReservation(
      key,
      clock.currentTimeMillisUnsafe()
    );
    if (reservation === null) {
      return yield* Effect.fail(OperationNotFound.literal);
    }
    reservation.cancelled ??= new CommandStatus({
      operationId,
      state: "cancelled",
      completedSteps: 0,
      totalSteps: 0,
    });
    return reservation.cancelled;
  }, Effect.uninterruptible);

  const status = Effect.fn("ExampleRpc.Commands.status")(function* ({
    operationId,
  }: {
    readonly operationId: string;
  }) {
    const { key } = yield* ownedCommand(operationId);
    const current = running.get(key)?.status ?? history.get(key);
    if (current !== undefined) {
      return current;
    }
    const reservation = getLiveReservation(
      key,
      clock.currentTimeMillisUnsafe()
    );
    return reservation === null
      ? yield* Effect.fail(OperationNotFound.literal)
      : reservation.cancelled;
  });

  const reset = Effect.gen(function* () {
    for (const command of running.values()) {
      yield* Deferred.done(command.cancellation, Exit.void);
      yield* Deferred.await(command.done);
    }
    reservations.clear();
    history.clear();
  });

  return { start, reserve, cancel, status, reset };
});
