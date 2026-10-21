import {
  Cause,
  Duration,
  Effect,
  Exit,
  Option,
  Pull,
  Result,
  Scope,
  Stream,
} from "effect";

/** Local delivery state; it does not acknowledge server-side persistence or cleanup. */
export type StreamConnectionState<E> =
  | {
      readonly status: "connecting" | "connected";
      readonly cursor: number;
      readonly attempt: number;
    }
  | {
      readonly status: "backing-off";
      readonly cursor: number;
      readonly attempt: number;
      readonly delay: Duration.Duration;
      readonly cause: Cause.Cause<E>;
    }
  | {
      readonly status: "refreshing";
      readonly cursor: number;
      readonly attempt: number;
      readonly cause: Cause.Cause<E>;
    }
  | { readonly status: "completed" | "stopped"; readonly cursor: number }
  | {
      readonly status: "failed";
      readonly cursor: number;
      readonly cause: Cause.Cause<E>;
    };

export interface RecoverStreamOptions<A, E, R = never> {
  /** Acquires an application-owned native stream using the last accepted cursor. */
  readonly connect: (cursor: number) => Stream.Stream<A, E, R>;
  /** One nonnegative safe-integer sequence per owner; older cursors are discarded. */
  readonly cursor: (value: A) => number;
  readonly initialCursor?: number | undefined;
  /** One-based retry count across this consumption. Undefined stops with the original Cause. */
  readonly retryDelay: (
    cause: Cause.Cause<E>,
    attempt: number
  ) => Duration.Input | undefined;
  readonly isReplayExpired?: ((cause: Cause.Cause<E>) => boolean) | undefined;
  /** Refreshes authoritative reads and returns their replay cursor before reconnecting. */
  readonly onReplayExpired?:
    | ((cause: Cause.Cause<E>) => Effect.Effect<number, E, R>)
    | undefined;
  /** Runs before accepting a gap; applications can refresh affected reads here. */
  readonly onGap?:
    | ((previous: number, next: number) => Effect.Effect<void, E, R>)
    | undefined;
  readonly onState?:
    | ((state: StreamConnectionState<E>) => Effect.Effect<void, never, R>)
    | undefined;
}

const checkedCursor = (cursor: number): number => {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new RangeError(
      "Stream recovery cursors must be nonnegative safe integers"
    );
  }
  return cursor;
};

/** Restarts a decoded stream without putting attempt-specific resume state in a query key. */
export const recoverStream = <A, E, R = never>(
  options: RecoverStreamOptions<A, E, R>
): Stream.Stream<A, E, R> =>
  Stream.suspend(() => {
    let cursor = checkedCursor(options.initialCursor ?? 0);
    const state = (value: StreamConnectionState<E>) =>
      options.onState?.(value) ?? Effect.void;
    const connect = (attempt: number): Stream.Stream<A, E, R> =>
      Stream.unwrap(
        Effect.gen(function* connectStream() {
          yield* state({ status: "connecting", cursor, attempt });
          const scope = yield* Scope.make();
          yield* Effect.addFinalizer((exit) => Scope.close(scope, exit));
          const source = Stream.suspend(() => options.connect(cursor)).pipe(
            Stream.rechunk(1),
            Stream.mapEffect(
              Effect.fnUntraced(function* trackCursor(value: A) {
                const next = checkedCursor(options.cursor(value));
                if (next <= cursor) {
                  return Option.none<A>();
                }
                if (next > cursor + 1) {
                  yield* options.onGap?.(cursor, next) ?? Effect.void;
                }
                cursor = next;
                yield* state({ status: "connected", cursor, attempt });
                return Option.some(value);
              })
            ),
            Stream.filter(Option.isSome),
            Stream.map((value) => value.value)
          );
          const pull = yield* Stream.toPull(source).pipe(Scope.provide(scope));
          return Stream.fromPull(
            Effect.succeed(
              Effect.uninterruptibleMask((restore) =>
                restore(pull).pipe(
                  Effect.onError((cause) =>
                    Scope.close(scope, Pull.doneExitFromCause(cause))
                  ),
                  Effect.catchCause((cause) => {
                    const completion = Pull.filterDone(cause);
                    return Effect.failCause(
                      Result.isFailure(completion) ? completion.failure : cause
                    );
                  })
                )
              )
            )
          );
        })
      ).pipe(
        Stream.catchCause((cause) => {
          if (Cause.hasInterrupts(cause)) {
            return Stream.failCause(cause);
          }
          return Stream.unwrap(
            Effect.gen(function* recoverConnection() {
              const nextAttempt = attempt + 1;
              const delayInput = options.retryDelay(cause, nextAttempt);
              const expired = options.isReplayExpired?.(cause) === true;
              if (
                delayInput === undefined ||
                (expired && options.onReplayExpired === undefined)
              ) {
                return yield* Effect.failCause(cause);
              }
              const delay = Duration.fromInputUnsafe(delayInput);
              yield* state({
                status: "backing-off",
                cursor,
                attempt: nextAttempt,
                delay,
                cause,
              });
              yield* Effect.sleep(delay);
              if (expired && options.onReplayExpired !== undefined) {
                yield* state({
                  status: "refreshing",
                  cursor,
                  attempt: nextAttempt,
                  cause,
                });
                cursor = checkedCursor(yield* options.onReplayExpired(cause));
              }
              return connect(nextAttempt);
            })
          );
        })
      );
    return connect(0).pipe(
      Stream.onExit((exit) => {
        if (Exit.isSuccess(exit)) {
          return state({ status: "completed", cursor });
        }
        return state(
          Cause.hasInterrupts(exit.cause)
            ? { status: "stopped", cursor }
            : { status: "failed", cursor, cause: exit.cause }
        );
      })
    );
  });
