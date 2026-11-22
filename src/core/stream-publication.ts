const streamQueryIterable = <A>(
  source: AsyncIterable<A>,
  signal: AbortSignal,
  emptyError: (() => Error) | undefined
): AsyncIterable<A> => ({
  [Symbol.asyncIterator]() {
    const iterator = source[Symbol.asyncIterator]();
    let closePromise: Promise<IteratorResult<A>> | undefined;
    let emitted = false;
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
          if (!emitted && !signal.aborted && emptyError !== undefined) {
            throw emptyError();
          }
        }
        emitted = true;
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

const retainPending = <A>(
  pending: A[],
  value: A,
  latestOnly: boolean | undefined
): A[] => {
  if (latestOnly === true) {
    return [value];
  }
  pending.push(value);
  return pending;
};

type PullResult<A> =
  | { readonly kind: "value"; readonly result: IteratorResult<A> }
  | { readonly kind: "error"; readonly error: unknown };

const finishPublication = async <A>(
  iterator: AsyncIterator<A>,
  pull: Promise<PullResult<A>> | undefined
): Promise<void> => {
  try {
    await iterator.return?.();
  } finally {
    // A deadline can win while cancellation's finalizer failure is still in the pull.
    const remaining = await pull;
    if (remaining?.kind === "error") {
      // oxlint-disable-next-line eslint/no-unsafe-finally
      throw remaining.error;
    }
  }
};

export const streamPublicationBatches =
  async function* streamPublicationBatches<A>(
    source: AsyncIterable<A>,
    batchSize: number,
    signal: AbortSignal,
    maxWaitMs?: number,
    live?: { readonly emptyError: (() => Error) | undefined }
  ): AsyncIterable<readonly A[]> {
    const iterator = streamQueryIterable(source, signal, live?.emptyError)[
      Symbol.asyncIterator
    ]();
    let first = true;
    let pending: A[] = [];
    let pull: Promise<PullResult<A>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: Promise<"deadline"> | undefined;
    const clearDeadline = () => {
      clearTimeout(timer);
      timer = undefined;
      deadline = undefined;
    };
    const pullNext = async (): Promise<PullResult<A>> => {
      try {
        return { kind: "value", result: await iterator.next() };
      } catch (error) {
        return { kind: "error", error };
      }
    };
    const startDeadline = (milliseconds: number) => {
      // oxlint-disable-next-line promise/avoid-new
      deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
          resolve("deadline");
        }, milliseconds);
      });
    };
    try {
      while (!signal.aborted) {
        pull ??= pullNext();
        // Pull sequentially to preserve event order and bound in-flight work.
        // oxlint-disable-next-line eslint/no-await-in-loop
        const result = await (deadline === undefined
          ? pull
          : Promise.race([pull, deadline]));
        if (result !== "deadline" && result.kind === "error") {
          throw result.error;
        }
        if (signal.aborted) {
          return;
        }
        if (result === "deadline") {
          const batch = pending;
          pending = [];
          clearDeadline();
          yield batch;
          continue;
        }
        pull = undefined;
        if (result.result.done === true) {
          break;
        }
        pending = retainPending(
          pending,
          result.result.value,
          live !== undefined
        );
        if (first || pending.length === batchSize) {
          first = false;
          const batch = pending;
          pending = [];
          clearDeadline();
          yield batch;
        } else if (deadline === undefined && maxWaitMs !== undefined) {
          startDeadline(maxWaitMs);
        }
      }
    } catch (error) {
      clearDeadline();
      if (pending.length > 0 && !signal.aborted) {
        yield pending;
        pending = [];
      }
      throw error;
    } finally {
      clearDeadline();
      await finishPublication(iterator, pull);
    }
    if (pending.length > 0 && !signal.aborted) {
      yield pending;
    }
  };

// Reuse the ordered consumer's deadline, single pull, and cleanup contract,
// retaining only one unpublished complete-state snapshot.
const coalescedSnapshots = async function* coalescedSnapshots<A>(
  source: AsyncIterable<A>,
  signal: AbortSignal,
  coalesceMs: number,
  emptyError: (() => Error) | undefined
): AsyncIterable<A | undefined> {
  for await (const batch of streamPublicationBatches(
    source,
    Infinity,
    signal,
    coalesceMs,
    { emptyError }
  )) {
    yield batch[0];
  }
};

export const streamLiveSnapshots = <A>(
  source: AsyncIterable<A>,
  signal: AbortSignal,
  coalesceMs: number | undefined,
  emptyError: (() => Error) | undefined
): AsyncIterable<A | undefined> =>
  coalesceMs === undefined
    ? streamQueryIterable(source, signal, emptyError)
    : coalescedSnapshots(source, signal, coalesceMs, emptyError);
