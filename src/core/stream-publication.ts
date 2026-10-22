type PullResult<A> =
  | { readonly kind: "value"; readonly result: IteratorResult<A> }
  | { readonly kind: "error"; readonly error: unknown };

export const streamPublicationBatches =
  async function* streamPublicationBatches<A>(
    source: AsyncIterable<A>,
    batchSize: number,
    signal: AbortSignal,
    maxWaitMs?: number
  ): AsyncIterable<readonly A[]> {
    const iterator = source[Symbol.asyncIterator]();
    let first = true;
    let pending: A[] = [];
    let pull: Promise<PullResult<A>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: Promise<"deadline"> | undefined;
    let closing: Promise<void> | undefined;
    const close = async () => {
      closing ??= (async () => {
        await iterator.return?.();
      })();
      await closing;
    };
    const onAbort = () => {
      // The finally block awaits and propagates cleanup failures.
      // oxlint-disable-next-line promise/prefer-await-to-then
      void close().catch(() => {
        /* Awaited again in finally, which propagates the failure. */
      });
    };
    signal.addEventListener("abort", onAbort, { once: true });
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
        pending.push(result.result.value);
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
      signal.removeEventListener("abort", onAbort);
      await close();
      // A deadline can win while cancellation's finalizer failure is still in the pull.
      const remaining = await pull;
      if (remaining?.kind === "error") {
        // Preserve pull failures even when cancellation or consumer return ended the generator.
        // oxlint-disable-next-line eslint/no-unsafe-finally
        throw remaining.error;
      }
    }
    if (pending.length > 0 && !signal.aborted) {
      yield pending;
    }
  };
