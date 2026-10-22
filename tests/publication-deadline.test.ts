import { describe, expect, it, vi } from "vitest";

import { streamPublicationBatches } from "../src/core/stream-publication";

describe("publication deadlines", () => {
  it("flushes quiet batches on a deadline without concurrent pulls", async () => {
    vi.useFakeTimers();
    let deliver!: (value: IteratorResult<number>) => void;
    let pulls = 0;
    let closed = 0;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          pulls += 1;
          // oxlint-disable-next-line promise/avoid-new
          return await new Promise((resolve) => {
            deliver = resolve;
          });
        },
        return: async () => {
          closed += 1;
          deliver({ done: true, value: undefined });
          return await Promise.resolve({ done: true, value: undefined });
        },
      }),
    };
    const controller = new AbortController();
    const iterator = streamPublicationBatches(
      source,
      10,
      controller.signal,
      50
    )[Symbol.asyncIterator]();
    try {
      const first = iterator.next();
      deliver({ done: false, value: 1 });
      await expect(first).resolves.toStrictEqual({ done: false, value: [1] });
      const second = iterator.next();
      deliver({ done: false, value: 2 });
      await vi.advanceTimersByTimeAsync(49);
      const pullsBeforeDeadline = pulls;
      await vi.advanceTimersByTimeAsync(1);
      await expect(second).resolves.toStrictEqual({ done: false, value: [2] });
      const third = iterator.next();
      const pullsAfterDeadline = pulls;
      deliver({ done: false, value: 3 });
      await vi.advanceTimersByTimeAsync(50);
      await expect(third).resolves.toStrictEqual({ done: false, value: [3] });
      const ending = iterator.next();
      controller.abort();
      await expect(ending).resolves.toStrictEqual({
        done: true,
        value: undefined,
      });
      expect({
        pullsBeforeDeadline,
        pullsAfterDeadline,
        closed,
        timers: vi.getTimerCount(),
      }).toStrictEqual({
        pullsBeforeDeadline: 3,
        pullsAfterDeadline: 3,
        closed: 1,
        timers: 0,
      });
    } finally {
      controller.abort();
      await iterator.return?.();
      vi.useRealTimers();
    }
  });
});
