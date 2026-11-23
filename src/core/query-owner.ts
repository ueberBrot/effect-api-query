import {
  CancelledError,
  MutationCache,
  QueryCache,
  QueryClient,
  skipToken,
} from "@tanstack/query-core";
import type {
  QueryClientConfig,
  QueryFunctionContext,
} from "@tanstack/query-core";
import { Cause, Exit, Predicate } from "effect";

import { isCallback } from "./configure";
import type {
  RuntimeMutationBuilder,
  RuntimeMutationFunction,
  RuntimeOptions,
  RuntimeQueryBuilder,
} from "./configure";
import {
  readConfiguredLeaf,
  registerLeafTracking,
  reapplyLeafConfiguration,
} from "./configure-utils";
import { getExecutionCause } from "./declared-error";
import { resolveRuntime } from "./runtime";
import type { RunPromiseExit, RuntimeInput } from "./types";
import { isUtilityNode, mapUtilityChildren } from "./utility-node";
import type { RuntimeUtilityNode, UtilityNode } from "./utility-node";
import { rebuildLeafForOwner } from "./utility-tree";

const trackedOwners = new WeakMap<UtilityNode, symbol>();

const queryOptionNames = [
  "queryOptions",
  "infiniteOptions",
  "metadataOptions",
  "liveOptions",
  "streamedOptions",
] as const;

interface PendingWork {
  readonly result: Promise<unknown>;
  cancelled: boolean;
  failedExit?: Cause.Cause<unknown> | undefined;
}

const drainAcceptedWork = async (
  accepted: readonly PendingWork[]
): Promise<unknown[]> => {
  const completions: PendingWork["result"][] = [];
  for (const { result } of accepted) {
    completions.push(result);
  }
  const settled = await Promise.allSettled(completions);
  const failures: unknown[] = [];
  const wrappedCauses = new Map<Cause.Cause<unknown>, number>();
  const failedExits: Cause.Cause<unknown>[] = [];
  for (const [index, work] of accepted.entries()) {
    const outcome = settled[index];
    if (work.failedExit !== undefined) {
      failedExits.push(work.failedExit);
    }
    if (outcome?.status !== "rejected" || work.cancelled) {
      continue;
    }
    failures.push(outcome.reason);
    const cause = getExecutionCause(outcome.reason);
    if (cause !== undefined) {
      wrappedCauses.set(cause, (wrappedCauses.get(cause) ?? 0) + 1);
    }
  }
  for (const cause of failedExits) {
    const wrapped = wrappedCauses.get(cause) ?? 0;
    if (wrapped === 0) {
      failures.push(cause);
    } else {
      wrappedCauses.set(cause, wrapped - 1);
    }
  }
  return failures;
};

const failedExitCause = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
    ? exit.cause
    : undefined;

/** Configures how a wrapped runner behaves when its query owner retires. */
export interface WrapRunnerOptions {
  /**
   * Controls whether executions started through the wrapped runner are
   * interrupted on owner retirement. Defaults to interrupting only when a
   * caller `AbortSignal` is passed.
   */
  readonly interruptOnRetire?: boolean | undefined;
}

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
   * Tracks utility runner calls. Accepts a `RunPromiseExit` function or an object
   * with a `runPromiseExit` method (such as `ManagedRuntime<R, never>`).
   */
  readonly wrapRunner: <R>(
    runner: RuntimeInput<R>,
    options?: WrapRunnerOptions
  ) => RunPromiseExit<R>;
  /**
   * Binds a generated utility tree, branch, or leaf to this owner so runners,
   * all query views, and mutations are tracked for retirement.
   */
  readonly trackUtils: <Node extends UtilityNode>(node: Node) => Node;
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
  const ownerToken = Symbol("QueryOwner");
  const releases: (() => void | Promise<void>)[] = [];
  const pending = new Set<PendingWork>();
  const queries = new Set<AbortController>();
  const queryClient = new QueryClient({
    ...cacheConfig,
    queryCache: new QueryCache({ ...cacheConfig?.queryCache?.config }),
    mutationCache: new MutationCache({ ...cacheConfig?.mutationCache?.config }),
  });
  let active = true;
  let disposal: Promise<void> | undefined;
  const assertActive = () => {
    if (!active) {
      throw new Error("Query owner is retired");
    }
  };
  const track = async <T>(
    execute: () => Promise<T>,
    signal?: AbortSignal,
    readFailure?: (value: T) => Cause.Cause<unknown> | undefined
  ): Promise<T> => {
    assertActive();
    let complete!: (value: T | PromiseLike<T>) => void;
    // oxlint-disable-next-line anti-slop/no-unknown-parameters
    let fail!: (error: unknown) => void;
    // oxlint-disable-next-line promise/avoid-new
    const result = new Promise<T>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    const work: PendingWork = { result, cancelled: false };
    pending.add(work);
    void (async () => {
      try {
        const value = await execute();
        if (!active) {
          work.failedExit = readFailure?.(value);
        }
        complete(value);
      } catch (error) {
        const cause = getExecutionCause(error);
        work.cancelled =
          signal?.aborted === true &&
          (error instanceof CancelledError ||
            (cause !== undefined && Cause.hasInterruptsOnly(cause)));
        fail(error);
      }
    })();
    try {
      return await result;
    } finally {
      pending.delete(work);
    }
  };
  const wrapRunner: QueryOwner<A>["wrapRunner"] = (input, wrapOptions) => {
    const runner = resolveRuntime(input);
    const interruptOnRetire = wrapOptions?.interruptOnRetire;
    return async (effect, options) =>
      track(
        async () => {
          const shouldInterruptOnRetire =
            interruptOnRetire ?? options?.signal !== undefined;
          if (!shouldInterruptOnRetire) {
            return await runner(
              effect,
              options?.signal === undefined
                ? undefined
                : { signal: options.signal }
            );
          }
          const controller = new AbortController();
          const abort = () => {
            controller.abort();
          };
          queries.add(controller);
          options?.signal?.addEventListener("abort", abort, { once: true });
          if (options?.signal?.aborted === true) {
            controller.abort();
          }
          try {
            return await runner(effect, { signal: controller.signal });
          } finally {
            queries.delete(controller);
            options?.signal?.removeEventListener("abort", abort);
          }
        },
        undefined,
        failedExitCause
      );
  };
  const wrapLeafExecution = (
    rebuilt: RuntimeUtilityNode
  ): RuntimeUtilityNode => {
    const { call } = rebuilt;
    if (isCallback(call)) {
      rebuilt["call"] = async (options?: RuntimeOptions) => {
        assertActive();
        return await call(options);
      };
    }
    for (const view of queryOptionNames) {
      if (!Object.hasOwn(rebuilt, view)) {
        continue;
      }
      const candidate = rebuilt[view];
      if (!Predicate.isFunction(candidate)) {
        continue;
      }
      // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
      const builder = candidate as RuntimeQueryBuilder;
      rebuilt[view] = (options?: RuntimeOptions) => {
        const built = builder(options);
        const { queryFn } = built;
        if (queryFn === skipToken) {
          return built;
        }
        return {
          ...built,
          queryFn: async (context: QueryFunctionContext) =>
            await track(async () => await queryFn(context), context.signal),
        };
      };
    }
    if (Object.hasOwn(rebuilt, "mutationOptions")) {
      const candidate = rebuilt["mutationOptions"];
      if (Predicate.isFunction(candidate)) {
        // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
        const builder = candidate as RuntimeMutationBuilder;
        rebuilt["mutationOptions"] = (options?: RuntimeOptions) => {
          const built = builder(options);
          const { mutationFn } = built;
          const trackedMutationFn: RuntimeMutationFunction = async (
            variables,
            context
          ) => await track(async () => await mutationFn(variables, context));
          return {
            ...built,
            mutationFn: trackedMutationFn,
          };
        };
      }
    }
    return rebuilt;
  };
  const trackLeaf = (node: RuntimeUtilityNode): RuntimeUtilityNode => {
    const base = rebuildLeafForOwner(node, wrapRunner);
    const tracked = Object.freeze(wrapLeafExecution({ ...base }));
    registerLeafTracking(tracked, base, wrapLeafExecution);
    trackedOwners.set(tracked, ownerToken);
    return tracked;
  };
  const trackNode = (node: RuntimeUtilityNode): RuntimeUtilityNode => {
    const existingOwner = trackedOwners.get(node);
    if (existingOwner !== undefined) {
      if (existingOwner !== ownerToken) {
        throw new Error(
          "Utility node is already tracked by another query owner"
        );
      }
      return node;
    }
    const configured = readConfiguredLeaf(node);
    if (configured !== undefined) {
      const originalOwner = trackedOwners.get(configured.original);
      if (originalOwner !== undefined) {
        if (originalOwner !== ownerToken) {
          throw new Error(
            "Utility node is already tracked by another query owner"
          );
        }
        return node;
      }
      const trackedBase = trackLeaf(configured.original);
      const trackedConfigured = reapplyLeafConfiguration(
        trackedBase,
        configured.layers
      );
      trackedOwners.set(trackedConfigured, ownerToken);
      return trackedConfigured;
    }
    const frozen = mapUtilityChildren(node, trackNode, (slot) => {
      if (slot.ownerToken === undefined) {
        return { materialize: () => trackNode(slot.materialize()), ownerToken };
      }
      if (slot.ownerToken !== ownerToken) {
        throw new Error(
          "Utility node is already tracked by another query owner"
        );
      }
      return slot;
    });
    if (frozen === undefined) {
      return trackLeaf(node);
    }
    if (frozen === node) {
      return node;
    }
    trackedOwners.set(frozen, ownerToken);
    return frozen;
  };
  const trackUtils: QueryOwner<A>["trackUtils"] = <Node extends UtilityNode>(
    node: Node
  ): Node => {
    if (!isUtilityNode(node)) {
      throw new TypeError("Expected a generated utility tree, branch, or leaf");
    }
    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
    return trackNode(node) as Node;
  };
  // oxlint-disable-next-line typescript/promise-function-async
  const dispose = () => {
    if (disposal !== undefined) {
      return disposal;
    }
    active = false;
    const draining = drainAcceptedWork([...pending]);
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
      failures.push(...(await draining));
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
    wrapRunner,
    trackUtils,
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
