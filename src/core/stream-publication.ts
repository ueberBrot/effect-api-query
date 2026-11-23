import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Pull,
  Scope,
  Stream,
} from "effect";

type NonEmptyBatch<A> = readonly [A, ...A[]];

export const streamQueryIterable = <A>(
  source: AsyncIterable<A>,
  signal: AbortSignal
): AsyncIterable<A> => ({
  [Symbol.asyncIterator]() {
    const iterator = source[Symbol.asyncIterator]();
    let closePromise: Promise<IteratorResult<A>> | undefined;
    const detach = () => {
      // oxlint-disable-next-line eslint/no-use-before-define
      signal.removeEventListener("abort", onAbort);
    };
    const close = async () => {
      closePromise ??= (async () => {
        try {
          return (
            (await iterator.return?.()) ?? { done: true, value: undefined }
          );
        } finally {
          detach();
        }
      })();
      return await closePromise;
    };
    const onAbort = () => {
      // oxlint-disable-next-line promise/prefer-await-to-then
      void Promise.resolve().then(close).catch(detach);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    return {
      async next() {
        let result: IteratorResult<A>;
        if (signal.aborted) {
          result = await close();
        } else {
          try {
            result = await iterator.next();
          } catch (error) {
            detach();
            throw error;
          }
        }
        if (result.done === true) {
          detach();
        }
        return result;
      },
      return: close,
      async throw(cause?: unknown) {
        detach();
        if (iterator.throw !== undefined) {
          return await iterator.throw(cause);
        }
        await close();
        throw cause;
      },
    };
  },
});

const ensureNonEmpty = <A, E, R, E2 = never>(
  source: Stream.Stream<A, E, R>,
  emptyError: (() => E2) | undefined
): Stream.Stream<A, E | E2, R> => {
  if (emptyError === undefined) {
    return source;
  }
  return Stream.unwrap(
    Effect.gen(function* wrapNonEmpty() {
      const pull = yield* Stream.toPull(source);
      let emitted = false;
      const next: Pull.Pull<
        NonEmptyBatch<A>,
        E | E2,
        void,
        R
      > = Effect.uninterruptibleMask((restore) =>
        restore(pull).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              emitted = true;
            })
          ),
          Effect.catchCauseIf(
            (cause) => !emitted && Pull.isDoneCause(cause),
            () => Effect.fail(emptyError())
          )
        )
      );
      return Stream.fromPull(Effect.succeed(next));
    })
  );
};

const batchStream = <A, E, R>(
  source: Stream.Stream<A, E, R>,
  batchSize: number,
  maxWaitMs: number | undefined,
  latestOnly: boolean
): Stream.Stream<NonEmptyBatch<A>, E, R> =>
  Stream.unwrap(
    Effect.gen(function* setupPublication() {
      const scope = yield* Scope.Scope;
      const pull = yield* Stream.toPull(source);
      let first = true;
      let pending: [A, ...A[]] | undefined;
      let chunkIterator: Iterator<A> | undefined;
      let pendingPull:
        | Fiber.Fiber<NonEmptyBatch<A>, E | Cause.Done>
        | undefined;
      let deadlineFiber: Fiber.Fiber<void> | undefined;
      let deadlineGate: Deferred.Deferred<undefined> | undefined;
      let terminalCause: Cause.Cause<E | Cause.Done> | undefined;

      const clearDeadline = Effect.suspend(() => {
        const fiber = deadlineFiber;
        deadlineFiber = undefined;
        deadlineGate = undefined;
        return fiber === undefined ? Effect.void : Fiber.interrupt(fiber);
      });

      const startDeadline = Effect.fnUntraced(function* startDeadlineTimer(
        milliseconds: number
      ) {
        const gate = Deferred.makeUnsafe<undefined>();
        deadlineGate = gate;
        deadlineFiber = yield* Effect.sleep(Duration.millis(milliseconds)).pipe(
          Effect.andThen(Deferred.succeed(gate, undefined)),
          Effect.asVoid,
          Effect.forkIn(scope, { startImmediately: true })
        );
      });

      const takePending = (): NonEmptyBatch<A> | undefined => {
        const batch = pending;
        pending = undefined;
        return batch;
      };

      const flushBatch = (batch: NonEmptyBatch<A>) =>
        clearDeadline.pipe(Effect.as([batch] as const));

      const isDeadlineReached = () =>
        deadlineGate !== undefined && Deferred.isDoneUnsafe(deadlineGate);

      const drainChunk = Effect.gen(function* drainCurrentChunk() {
        while (chunkIterator !== undefined) {
          if (pending !== undefined && isDeadlineReached()) {
            return takePending();
          }
          const next = chunkIterator.next();
          if (next.done === true) {
            chunkIterator = undefined;
            break;
          }
          if (pending === undefined || latestOnly) {
            pending = [next.value];
          } else {
            pending.push(next.value);
          }
          if (first || pending.length === batchSize) {
            first = false;
            return takePending();
          }
          if (deadlineGate === undefined && maxWaitMs !== undefined) {
            yield* startDeadline(maxWaitMs);
          }
        }
        return pending !== undefined && isDeadlineReached()
          ? takePending()
          : undefined;
      });

      const pullOrWaitDeadline = Effect.gen(function* pullOrDeadline() {
        let activePull = pendingPull;
        if (activePull === undefined) {
          activePull = yield* Effect.forkIn(pull, scope, {
            startImmediately: true,
          });
          pendingPull = activePull;
        }
        const gate = deadlineGate;
        if (gate === undefined) {
          const exit = yield* Fiber.await(activePull);
          pendingPull = undefined;
          return { _tag: "Pull" as const, exit };
        }
        const outcome = yield* Effect.raceFirst(
          Fiber.await(activePull).pipe(
            Effect.map((exit) => ({ _tag: "Pull" as const, exit }))
          ),
          Deferred.await(gate).pipe(Effect.as({ _tag: "Deadline" as const }))
        );
        if (outcome._tag === "Pull") {
          pendingPull = undefined;
        }
        return outcome;
      });

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* finalizePublication() {
          yield* clearDeadline;
          const outstanding = pendingPull;
          pendingPull = undefined;
          if (outstanding !== undefined) {
            yield* Fiber.interrupt(outstanding);
            const exit = yield* Fiber.await(outstanding);
            if (
              Exit.isFailure(exit) &&
              !Pull.isDoneCause(exit.cause) &&
              !Cause.hasInterruptsOnly(exit.cause)
            ) {
              return yield* Effect.die(Cause.squash(exit.cause));
            }
          }
          return yield* Effect.void;
        })
      );

      const nextBatch: Pull.Pull<
        NonEmptyBatch<NonEmptyBatch<A>>,
        E,
        void,
        R
      > = Effect.gen(function* pullNextBatch() {
        while (true) {
          if (terminalCause !== undefined) {
            if (Cause.hasInterruptsOnly(terminalCause)) {
              pending = undefined;
            } else {
              const batch = takePending();
              if (batch !== undefined) {
                return yield* flushBatch(batch);
              }
            }
            const cause = terminalCause;
            terminalCause = undefined;
            return yield* Effect.failCause(cause);
          }

          const ready = yield* drainChunk;
          if (ready !== undefined) {
            return yield* flushBatch(ready);
          }

          const outcome = yield* pullOrWaitDeadline;
          if (outcome._tag === "Deadline") {
            const batch = takePending();
            if (batch !== undefined) {
              return yield* flushBatch(batch);
            }
            yield* clearDeadline;
            continue;
          }

          if (Exit.isFailure(outcome.exit)) {
            terminalCause = outcome.exit.cause;
            continue;
          }
          chunkIterator = outcome.exit.value[Symbol.iterator]();
        }
      });

      return Stream.fromPull(Effect.succeed(nextBatch));
    })
  );

export const streamPublicationBatches = <A, E, R>(
  source: Stream.Stream<A, E, R>,
  batchSize: number,
  maxWaitMs?: number
): Stream.Stream<readonly A[], E, R> =>
  batchSize === 1 && maxWaitMs === undefined
    ? source.pipe(Stream.map((value): readonly A[] => [value]))
    : batchStream(source, batchSize, maxWaitMs, false);

export const streamLiveSnapshots = <A, E, R, E2 = never>(
  source: Stream.Stream<A, E, R>,
  coalesceMs: number | undefined,
  emptyError: (() => E2) | undefined
): Stream.Stream<A, E | E2, R> => {
  const checked = ensureNonEmpty(source, emptyError);
  return coalesceMs === undefined
    ? checked
    : batchStream(checked, Infinity, coalesceMs, true).pipe(
        Stream.map((batch) => batch[0])
      );
};
