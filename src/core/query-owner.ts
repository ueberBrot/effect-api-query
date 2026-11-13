import { CancelledError, QueryClient } from "@tanstack/query-core";
import type { QueryClientConfig } from "@tanstack/query-core";
import { Cause, Exit } from "effect";

import {
  isEffectHttpApiQueryError,
  EffectHttpApiQueryEmptyStreamError,
} from "../http/errors";
import {
  isEffectRpcQueryError,
  EffectRpcQueryEmptyStreamError,
} from "../rpc/errors";
import type { RunPromiseExit } from "./types";

/** Registers only resources whose lifetime is explicitly transferred to the owner. */
export interface QueryOwnerSetup extends Omit<
  QueryOwner<never>,
  "resources" | "dispose"
> {
  /**
   * Await each acquisition sequentially within setup.
   * Keep the setup registrar inside the callback; detached acquisitions are unsupported.
   */
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
  /**
   * Tracks the complete query function and its local cleanup.
   * Pass the native query signal to classify cancellation.
   */
  readonly runQuery: <T>(
    execute: () => Promise<T>,
    signal: AbortSignal
  ) => Promise<T>;
  /** Accepts one complete application mutation promise, including awaited native callbacks. */
  readonly runMutation: <T>(execute: () => Promise<T>) => Promise<T>;
  /**
   * Tracks utility runner calls. For streams, also register the complete query
   * function with runQuery so retirement awaits iteration and cleanup.
   */
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
  const cancelled = new WeakSet<Promise<unknown>>();
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
  const track = async <T>(
    execute: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> => {
    assertActive();
    let complete!: (value: T | PromiseLike<T>) => void;
    // oxlint-disable-next-line anti-slop/no-unknown-parameters
    let fail!: (error: unknown) => void;
    // Register before executing so synchronous retirement sees all accepted work.
    // oxlint-disable-next-line promise/avoid-new
    const result = new Promise<T>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    pending.add(result);
    void (async () => {
      try {
        complete(await execute());
      } catch (error) {
        if (
          signal?.aborted === true &&
          (error instanceof CancelledError ||
            ((isEffectRpcQueryError(error) ||
              isEffectHttpApiQueryError(error)) &&
              Cause.hasInterruptsOnly(error.cause)) ||
            error instanceof EffectRpcQueryEmptyStreamError ||
            error instanceof EffectHttpApiQueryEmptyStreamError)
        ) {
          cancelled.add(result);
        }
        fail(error);
      }
    })();
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
    const accepted = [...pending];
    const draining = Promise.allSettled(accepted);
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
      for (const [index, result] of drained.entries()) {
        const promise = accepted[index];
        if (
          result.status === "rejected" &&
          (promise === undefined || !cancelled.has(promise))
        ) {
          failures.push(result.reason);
        }
      }
      failures.push(...drainFailures);
      try {
        queryClient.clear();
      } catch (error) {
        failures.push(error);
      }
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
