import { QueryClient } from "@tanstack/query-core";
import type { QueryClientConfig } from "@tanstack/query-core";
import { Cause, Exit } from "effect";

import type { RunPromiseExit } from "./types";

/** Registers only resources whose lifetime is explicitly transferred to the owner. */
export interface QueryOwnerSetup extends Omit<
  QueryOwner<never>,
  "resources" | "dispose"
> {
  readonly acquire: <A>(
    acquire: () => A | Promise<A>,
    release: (resource: A) => void | Promise<void>
  ) => Promise<A>;
  readonly borrow: <A>(resource: A) => A;
}

/** One isolated cache and its explicitly acquired application resources. */
export interface QueryOwner<A> {
  readonly resources: A;
  readonly queryClient: QueryClient;
  readonly isActive: () => boolean;
  /** Runs a synchronous cache callback only while active. Never capture a replacement cache. */
  readonly commit: (update: (client: QueryClient) => void) => void;
  /** Accepts one complete application mutation promise, including awaited native callbacks. */
  readonly runQuery: <T>(execute: () => Promise<T>) => Promise<T>;
  readonly runMutation: <T>(execute: () => Promise<T>) => Promise<T>;
  /** Wrap every utility runner so retirement can await local Effect/stream finalizers. */
  readonly wrapRunner: <R>(runner: RunPromiseExit<R>) => RunPromiseExit<R>;
  /** Retires synchronously; repeated calls return the same disposal result. */
  readonly dispose: () => Promise<void>;
}

/**
 * Acquires application resources with failure-safe, reverse-order disposal.
 * Each owner has an independent native QueryClient. Factories remain lifecycle-neutral.
 */
export const acquireQueryOwner = async <A>(
  acquire: (setup: QueryOwnerSetup) => Promise<A>,
  cacheConfig?: QueryClientConfig
): Promise<QueryOwner<A>> => {
  const releases: (() => void | Promise<void>)[] = [];
  const pending = new Set<Promise<unknown>>();
  const queries = new Set<AbortController>();
  const drainFailures: unknown[] = [];
  const queryClient = new QueryClient(cacheConfig);
  let active = true;
  let disposal: Promise<void> | undefined;
  const assertActive = () => {
    if (!active) {
      throw new Error("Query owner is retired");
    }
  };
  const track = async <T>(execute: () => Promise<T>): Promise<T> => {
    assertActive();
    // Register before invoking user code, including synchronous retirement/reentrancy.
    const result = (async () => {
      await Promise.resolve();
      return await execute();
    })();
    pending.add(result);
    try {
      return await result;
    } finally {
      pending.delete(result);
    }
  };
  // The same promise is part of the idempotent disposal contract.
  // oxlint-disable-next-line typescript/promise-function-async
  const dispose = () => {
    if (disposal !== undefined) {
      return disposal;
    }
    active = false;
    const draining = Promise.allSettled(pending);
    // Defer cleanup so reentrant calls see the same promise.
    disposal = (async () => {
      await Promise.resolve();
      const failures: unknown[] = [];
      for (const controller of queries) {
        controller.abort();
      }
      try {
        await queryClient.cancelQueries();
      } catch (error) {
        failures.push(error);
      }
      const drained = await draining;
      for (const result of drained) {
        if (result.status === "rejected") {
          failures.push(result.reason);
        }
      }
      failures.push(...drainFailures);
      queryClient.clear();
      while (releases.length > 0) {
        const release = releases.pop();
        if (release === undefined) {
          break;
        }
        try {
          // Resource finalizers run in reverse dependency order.
          // oxlint-disable-next-line eslint/no-await-in-loop
          await release();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Query owner disposal failed");
      }
    })();
    return disposal;
  };
  const lifecycle: Omit<QueryOwner<A>, "resources" | "dispose"> = {
    queryClient,
    isActive: () => active,
    commit: (update) => {
      if (active) {
        update(queryClient);
      }
    },
    runMutation: track,
    runQuery: track,
    wrapRunner: (runner) => async (effect, options) =>
      track(async () => {
        const controller =
          options?.signal === undefined ? undefined : new AbortController();
        const abort = () => controller?.abort();
        if (controller !== undefined) {
          queries.add(controller);
          options?.signal?.addEventListener("abort", abort, { once: true });
          if (options?.signal?.aborted === true) {
            controller.abort();
          }
        }
        try {
          const exit = await runner(
            effect,
            controller === undefined ? undefined : { signal: controller.signal }
          );
          // A cancellation with a failed finalizer is not a successful drain.
          if (
            !active &&
            Exit.isFailure(exit) &&
            !Cause.hasInterruptsOnly(exit.cause)
          ) {
            drainFailures.push(exit.cause);
          }
          return exit;
        } finally {
          if (controller !== undefined) {
            queries.delete(controller);
            options?.signal?.removeEventListener("abort", abort);
          }
        }
      }),
  };
  try {
    const resources = await acquire({
      ...lifecycle,
      acquire: async (start, release) => {
        assertActive();
        const resource = await start();
        releases.push(async () => release(resource));
        return resource;
      },
      borrow: (resource) => resource,
    });
    return { ...lifecycle, resources, dispose };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Query owner acquisition and cleanup failed",
        { cause: cleanupError }
      );
    }
    throw error;
  }
};
