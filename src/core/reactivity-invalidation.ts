import type {
  InvalidateOptions,
  InvalidateQueryFilters,
} from "@tanstack/query-core";
import { Array as Arr, Effect, Latch, Queue } from "effect";
import type { Scope } from "effect";
import type { Reactivity } from "effect/reactivity";

import { queryEffects } from "./query-effects";
import type { QueryClientService } from "./query-effects";

/** Maps Effect Reactivity keys to explicit TanStack Query filters. */
export interface ReactivityInvalidationBinding {
  readonly keys: Reactivity.KeysInput;
  readonly filter: InvalidateQueryFilters | readonly InvalidateQueryFilters[];
  readonly options?: InvalidateOptions;
}

/** Controls invalidations for a scoped Reactivity binding. */
export interface ReactivityInvalidationOptions {
  /** Default options for bindings that supply no options of their own. */
  readonly invalidateOptions?: InvalidateOptions;
  /** Use a query owner's guard to stop new invalidations at retirement. */
  readonly isActive?: () => boolean;
  /** Receives the original QueryClient failure. */
  readonly onError?: (error: unknown) => void;
}

const sanitizeKeys = (
  keys:
    | readonly unknown[]
    | Readonly<Record<string, readonly unknown[] | undefined>>
) => {
  if (Arr.isArray<typeof keys>(keys)) {
    return keys.length === 0 ? undefined : keys;
  }
  const entries: [string, readonly unknown[]][] = [];
  for (const [key, ids] of Object.entries(keys)) {
    if (ids !== undefined) {
      entries.push([key, ids]);
    }
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

const reportFailure = (
  onError: ((error: unknown) => void | PromiseLike<void>) | undefined,
  error: unknown
): Effect.Effect<void> =>
  onError === undefined
    ? Effect.void
    : Effect.tryPromise(async () => {
        await onError(error);
      }).pipe(Effect.ignore);

const bindWorker = Effect.fnUntraced(function* bindWorker(
  reactivity: Reactivity.Reactivity,
  bindings: readonly ReactivityInvalidationBinding[],
  options: ReactivityInvalidationOptions | undefined
) {
  const queue = yield* Queue.unbounded<ReactivityInvalidationBinding>();
  const idle = yield* Latch.make(true);
  const unregister: (() => void)[] = [];
  let closed = false;

  const isActive = () => !closed && options?.isActive?.() !== false;
  const onError: ((error: unknown) => void | PromiseLike<void>) | undefined =
    options?.onError;

  const invalidateFilter = (
    filter: InvalidateQueryFilters,
    invalidateOptions: InvalidateOptions | undefined
  ): Effect.Effect<void, never, QueryClientService> =>
    Effect.suspend(() =>
      isActive()
        ? queryEffects
            .invalidate(filter, invalidateOptions)
            .pipe(Effect.catch(({ cause }) => reportFailure(onError, cause)))
        : Effect.void
    );

  const runPass = (
    batch: readonly ReactivityInvalidationBinding[]
  ): Effect.Effect<void, never, QueryClientService> =>
    Effect.forEach(
      new Set(batch),
      (binding) => {
        const invalidateOptions = binding.options ?? options?.invalidateOptions;
        return Effect.forEach(
          Arr.ensure<InvalidateQueryFilters>(binding.filter),
          (filter) => invalidateFilter(filter, invalidateOptions),
          { concurrency: "unbounded", discard: true }
        );
      },
      { concurrency: "unbounded", discard: true }
    );

  const worker = Effect.forever(
    Effect.gen(function* processBatch() {
      const batch = yield* Queue.takeAll(queue);
      yield* runPass(batch);
      yield* Effect.sync(() => {
        if (Queue.sizeUnsafe(queue) === 0) {
          idle.openUnsafe();
        }
      });
    })
  ).pipe(Effect.ensuring(idle.open));

  yield* Effect.forkScoped(worker);

  const close = () => {
    closed = true;
    for (const release of unregister) {
      release();
    }
    unregister.length = 0;
    Queue.shutdownUnsafe(queue);
    idle.openUnsafe();
  };

  const enqueue = (binding: ReactivityInvalidationBinding): void => {
    if (!isActive()) {
      return;
    }
    if (Queue.offerUnsafe(queue, binding)) {
      idle.closeUnsafe();
    }
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      try {
        for (const binding of bindings) {
          const keys = sanitizeKeys(binding.keys);
          if (keys !== undefined) {
            unregister.push(
              reactivity.registerUnsafe(keys, () => {
                enqueue(binding);
              })
            );
          }
        }
      } catch (error) {
        close();
        throw error;
      }
    }),
    () => Effect.sync(close)
  );

  return { flush: idle.await };
});

/**
 * Loads Effect Reactivity and subscribes the current QueryClient until the Scope closes.
 * Run the returned flush Effect to wait for queued invalidations and native refetches.
 */
export const bindReactivityInvalidation = (
  bindings: readonly ReactivityInvalidationBinding[],
  options?: ReactivityInvalidationOptions
): Effect.Effect<
  { readonly flush: Effect.Effect<void> },
  never,
  Scope.Scope | Reactivity.Reactivity | QueryClientService
> =>
  Effect.promise(async () => await import("effect/reactivity/Reactivity")).pipe(
    Effect.flatMap(({ Reactivity: tag }) =>
      tag.pipe(
        Effect.flatMap((reactivity) =>
          bindWorker(reactivity, bindings, options)
        )
      )
    )
  );
