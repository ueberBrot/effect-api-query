export const streamPublicationBatches =
  async function* streamPublicationBatches<A>(
    source: AsyncIterable<A>,
    batchSize: number,
    signal: AbortSignal
  ): AsyncIterable<readonly A[]> {
    let first = true;
    let pending: A[] = [];
    try {
      for await (const value of source) {
        if (signal.aborted) {
          return;
        }
        pending.push(value);
        if (first || pending.length === batchSize) {
          first = false;
          const batch = pending;
          pending = [];
          yield batch;
        }
      }
    } catch (error) {
      if (pending.length > 0 && !signal.aborted) {
        yield pending;
        pending = [];
      }
      throw error;
    }
    if (pending.length > 0 && !signal.aborted) {
      yield pending;
    }
  };
