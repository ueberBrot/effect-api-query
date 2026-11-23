import type {
  InvalidateOptions,
  InvalidateQueryFilters,
} from "@tanstack/query-core";
import { Array as Arr, Cause, Effect, Latch } from "effect";
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

const bindInvalidations =
  /* @__PURE__ */
  Effect.fnUntraced(function* bindInvalidations(
    reactivity: Reactivity.Reactivity,
    bindings: readonly ReactivityInvalidationBinding[],
    options: ReactivityInvalidationOptions | undefined
  ) {
    const ready = yield* Latch.make();
    const idle = yield* Latch.make(true);
    const pending = new Set<ReactivityInvalidationBinding>();
    const unregister: (() => void)[] = [];
    let inFlight = 0;
    let closed = false;

    const isActive = () => !closed && options?.isActive?.() !== false;
    const onError: ((error: unknown) => void | PromiseLike<void>) | undefined =
      options?.onError;

    const invalidateFilter = (
      filter: InvalidateQueryFilters,
      invalidateOptions: InvalidateOptions | undefined
    ): Effect.Effect<void, never, QueryClientService> =>
      Effect.try(isActive).pipe(
        Effect.flatMap((active) =>
          active
            ? queryEffects.invalidate(filter, invalidateOptions)
            : Effect.void
        ),
        Effect.catch(({ cause }) => reportFailure(onError, cause))
      );

    const runPass = (
      batch: readonly ReactivityInvalidationBinding[]
    ): Effect.Effect<void, never, QueryClientService> =>
      Effect.forEach(
        batch,
        (binding) => {
          const invalidateOptions =
            binding.options ?? options?.invalidateOptions;
          return Effect.forEach(
            Arr.ensure<InvalidateQueryFilters>(binding.filter),
            (filter) => invalidateFilter(filter, invalidateOptions),
            { concurrency: "unbounded", discard: true }
          );
        },
        { concurrency: "unbounded", discard: true }
      );

    const isIdle = () => pending.size === 0 && inFlight === 0;
    const signalIdle = () => {
      if (isIdle()) {
        idle.openUnsafe();
      }
    };
    const dispatch = Effect.suspend(() => {
      ready.closeUnsafe();
      if (closed || pending.size === 0) {
        return Effect.void;
      }
      const batch = [...pending];
      pending.clear();
      inFlight += 1;
      return Effect.suspend(() => runPass(batch)).pipe(
        Effect.catchCause((cause) =>
          reportFailure(onError, Cause.squash(cause))
        ),
        Effect.ensuring(
          Effect.sync(() => {
            inFlight -= 1;
            signalIdle();
          })
        ),
        Effect.forkDetach({ startImmediately: true }),
        Effect.asVoid
      );
    }).pipe(Effect.uninterruptible);

    yield* ready.await.pipe(
      Effect.andThen(dispatch),
      Effect.forever({ disableYield: true }),
      Effect.forkScoped({ startImmediately: true })
    );

    const close = () => {
      closed = true;
      pending.clear();
      for (const release of unregister) {
        release();
      }
      unregister.length = 0;
      signalIdle();
    };

    const enqueue = (binding: ReactivityInvalidationBinding): void => {
      if (!isActive()) {
        return;
      }
      if (pending.size === 0) {
        queueMicrotask(() => {
          ready.openUnsafe();
        });
      }
      pending.add(binding);
      idle.closeUnsafe();
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

    const flush: Effect.Effect<void> = Effect.suspend(() =>
      isIdle() ? Effect.void : idle.await.pipe(Effect.andThen(flush))
    );
    return { flush };
  });

/**
 * Loads Effect Reactivity and subscribes the current QueryClient until the Scope closes.
 * Run the returned flush Effect to wait for queued invalidations and native refetches.
 */
export const bindReactivityInvalidation: (
  bindings: readonly ReactivityInvalidationBinding[],
  options?: ReactivityInvalidationOptions
) => Effect.Effect<
  { readonly flush: Effect.Effect<void> },
  never,
  Scope.Scope | Reactivity.Reactivity | QueryClientService
> =
  /* @__PURE__ */
  Effect.fnUntraced(function* bindReactivityInvalidation(
    bindings: readonly ReactivityInvalidationBinding[],
    options?: ReactivityInvalidationOptions
  ) {
    const { Reactivity: tag } = yield* Effect.promise(
      async () => await import("effect/reactivity/Reactivity")
    );
    const reactivity = yield* tag;
    return yield* bindInvalidations(reactivity, bindings, options);
  });
