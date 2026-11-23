import { noop } from "@tanstack/query-core";
import type {
  InvalidateOptions,
  InvalidateQueryFilters,
  QueryClient,
} from "@tanstack/query-core";
import { Array as Arr, Effect } from "effect";
import type { Scope } from "effect";
import type { Reactivity } from "effect/reactivity";

import { QueryClientService } from "./query-effects";

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

const registerBindings = (
  reactivity: Reactivity.Reactivity,
  client: QueryClient,
  bindings: readonly ReactivityInvalidationBinding[],
  options: ReactivityInvalidationOptions | undefined
) => {
  const inFlight = new Set<Promise<void>>();
  const pending = new Set<ReactivityInvalidationBinding>();
  const unregister: (() => void)[] = [];
  let closed = false;

  const isActive = () => !closed && options?.isActive?.() !== false;
  const onError: ((error: unknown) => void | PromiseLike<void>) | undefined =
    options?.onError;
  const report = async (error: unknown): Promise<void> => {
    await onError?.(error);
  };
  const runPass = async (): Promise<void> => {
    const batch = [...pending];
    pending.clear();
    await Promise.all(
      batch.flatMap((binding) =>
        Arr.ensure<InvalidateQueryFilters>(binding.filter).map(
          async (filter) => {
            try {
              if (isActive()) {
                await client.invalidateQueries(
                  filter,
                  binding.options ?? options?.invalidateOptions
                );
              }
            } catch (error) {
              await report(error).catch(noop);
            }
          }
        )
      )
    );
  };
  const enqueue = (binding: ReactivityInvalidationBinding): void => {
    if (!isActive()) {
      return;
    }
    if (pending.size === 0) {
      const pass = Promise.resolve()
        .then(runPass)
        .catch(report)
        .catch(noop)
        .finally(() => {
          inFlight.delete(pass);
        });
      inFlight.add(pass);
    }
    pending.add(binding);
  };

  const close = () => {
    closed = true;
    pending.clear();
    for (const release of unregister) {
      release();
    }
    unregister.length = 0;
  };
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

  const flush: Effect.Effect<void> = Effect.suspend(() =>
    inFlight.size === 0
      ? Effect.void
      : Effect.promise(async () => {
          await Promise.all(inFlight);
        }).pipe(Effect.andThen(flush))
  );
  return { close, flush };
};

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
  Effect.flatMap(
    Effect.promise(async () => await import("effect/reactivity/Reactivity")),
    ({ Reactivity: tag }) =>
      Effect.gen(function* bindSubscriptions() {
        const reactivity = yield* tag;
        const client = yield* QueryClientService;
        const { flush } = yield* Effect.acquireRelease(
          Effect.sync(() =>
            registerBindings(reactivity, client, bindings, options)
          ),
          (bridge) => Effect.sync(bridge.close)
        );
        return { flush };
      })
  );
