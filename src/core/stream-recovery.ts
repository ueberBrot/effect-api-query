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
export type StreamConnectionState<E, C = number> =
  | {
      readonly status: "connecting" | "connected";
      readonly cursor: C;
      readonly attempt: number;
    }
  | {
      readonly status: "backing-off";
      readonly cursor: C;
      readonly attempt: number;
      readonly delay: Duration.Duration;
      readonly cause: Cause.Cause<E>;
    }
  | {
      readonly status: "refreshing";
      readonly cursor: C;
      readonly attempt: number;
      readonly cause: Cause.Cause<E>;
    }
  | { readonly status: "completed" | "stopped"; readonly cursor: C }
  | {
      readonly status: "failed";
      readonly cursor: C;
      readonly cause: Cause.Cause<E>;
    };

/** Application policy over decoded cursors; no order or gap semantics are inferred. */
export interface StreamCursorPolicy<C> {
  readonly accept: (previous: C, next: C) => boolean;
  readonly isGap?: ((previous: C, next: C) => boolean) | undefined;
}

export interface RecoveryHooks<A, E, R, C, EG, RG, EF, RF, RS> {
  readonly connect: (cursor: C) => Stream.Stream<A, E, R>;
  readonly cursor: (value: A) => C;
  /** One-based retry count across this consumption. Undefined preserves the Cause. */
  readonly retryDelay: (
    cause: Cause.Cause<E | EG | EF>,
    attempt: number
  ) => Duration.Input | undefined;
  readonly isReplayExpired?:
    | ((cause: Cause.Cause<E | EG | EF>) => boolean)
    | undefined;
  /** Return the replay cursor matching the authoritative refreshed state. */
  readonly onReplayExpired?:
    | ((cause: Cause.Cause<E | EG | EF>) => Effect.Effect<C, EF, RF>)
    | undefined;
  /** Runs before advancing the cursor or delivering an accepted gap. */
  readonly onGap?:
    | ((previous: C, next: C) => Effect.Effect<void, EG, RG>)
    | undefined;
  readonly onState?:
    | ((
        state: StreamConnectionState<E | EG | EF, C>
      ) => Effect.Effect<void, never, RS>)
    | undefined;
}

/** Existing annotations retain their numeric cursor and shared error/service contract. */
export type RecoverStreamOptions<
  A,
  E,
  R = never,
  C = number,
  EG = E,
  RG = R,
  EF = E,
  RF = R,
  RS = R,
> = RecoveryHooks<A, E, R, C, EG, RG, EF, RF, RS> &
  (
    | {
        readonly initialCursor: C;
        readonly cursorPolicy: StreamCursorPolicy<C>;
      }
    | (C extends number
        ? {
            readonly initialCursor?: number | undefined;
            readonly cursorPolicy?: undefined;
          }
        : never)
  );

const checkedCursor = (cursor: number): number => {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new RangeError(
      "Stream recovery cursors must be nonnegative safe integers"
    );
  }
  return cursor;
};

const recoverWithPolicy = <A, E, R, C, EG, RG, EF, RF, RS>(
  options: RecoveryHooks<A, E, R, C, EG, RG, EF, RF, RS>,
  initialCursor: C,
  policy: StreamCursorPolicy<C>,
  check: (cursor: C) => C
): Stream.Stream<A, E | EG | EF, R | RG | RF | RS> => {
  const state = (value: StreamConnectionState<E | EG | EF, C>) =>
    options.onState?.(value) ?? Effect.void;
  return Stream.suspend(() => {
    let cursor = check(initialCursor);
    const connect = (
      attempt: number
    ): Stream.Stream<A, E | EG | EF, R | RG | RF | RS> =>
      Stream.unwrap(
        Effect.gen(function* connectStream() {
          yield* state({ status: "connecting", cursor, attempt });
          const scope = yield* Scope.make();
          yield* Effect.addFinalizer((exit) => Scope.close(scope, exit));
          const source = Stream.suspend(() => options.connect(cursor)).pipe(
            Stream.rechunk(1),
            Stream.mapEffect(
              Effect.fnUntraced(function* trackCursor(value: A) {
                const next = check(options.cursor(value));
                if (!policy.accept(cursor, next)) {
                  return Option.none<A>();
                }
                if (policy.isGap?.(cursor, next) === true) {
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
                cursor = check(yield* options.onReplayExpired(cause));
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
};

/** Restarts a decoded stream with consumption-local state outside query identity. */
export function recoverStream<
  A,
  E,
  R = never,
  EG = never,
  RG = never,
  EF = never,
  RF = never,
  RS = never,
>(
  options: RecoveryHooks<A, E, R, number, EG, RG, EF, RF, RS> & {
    readonly initialCursor?: number | undefined;
    readonly cursorPolicy?: undefined;
  }
): Stream.Stream<A, NoInfer<E | EG | EF>, NoInfer<R | RG | RF | RS>>;
export function recoverStream<
  A,
  E,
  R,
  C,
  EG = never,
  RG = never,
  EF = never,
  RF = never,
  RS = never,
>(
  options: RecoveryHooks<A, E, R, C, EG, RG, EF, RF, RS> & {
    readonly initialCursor: C;
    readonly cursorPolicy: StreamCursorPolicy<C>;
  }
): Stream.Stream<A, NoInfer<E | EG | EF>, NoInfer<R | RG | RF | RS>>;
export function recoverStream<
  A,
  E,
  R = never,
  C = number,
  EG = E,
  RG = R,
  EF = E,
  RF = R,
  RS = R,
>(
  // Preserve union-typed annotations separately from direct callback inference.
  // oxlint-disable-next-line typescript/unified-signatures
  options: RecoverStreamOptions<A, E, R, C, EG, RG, EF, RF, RS>
): Stream.Stream<A, NoInfer<E | EG | EF>, NoInfer<R | RG | RF | RS>>;
export function recoverStream<A, E, R, C, EG, RG, EF, RF, RS>(
  options:
    | (RecoveryHooks<A, E, R, C, EG, RG, EF, RF, RS> & {
        readonly initialCursor: C;
        readonly cursorPolicy: StreamCursorPolicy<C>;
      })
    | (RecoveryHooks<A, E, R, number, EG, RG, EF, RF, RS> & {
        readonly initialCursor?: number | undefined;
        readonly cursorPolicy?: undefined;
      })
): Stream.Stream<A, E | EG | EF, R | RG | RF | RS> {
  if (options.cursorPolicy !== undefined) {
    return recoverWithPolicy(
      options,
      options.initialCursor,
      options.cursorPolicy,
      (cursor) => cursor
    );
  }
  return recoverWithPolicy(
    options,
    options.initialCursor ?? 0,
    {
      accept: (previous, next) => next > previous,
      isGap: (previous, next) => next > previous + 1,
    },
    checkedCursor
  );
}
