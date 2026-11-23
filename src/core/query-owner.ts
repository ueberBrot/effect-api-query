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

import { isEffectHttpApiQueryError } from "../http/errors";
import { isEffectRpcQueryError } from "../rpc/errors";
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
import { resolveRuntime } from "./runtime";
import type { RunPromiseExit, RuntimeInput } from "./types";
import { isUtilityNode, mapUtilityChildren } from "./utility-node";
import type { RuntimeUtilityNode, UtilityNode } from "./utility-node";
import { readLeafDescriptor } from "./utility-tree";

const trackedOwners = new WeakMap<UtilityNode, symbol>();

const queryOptionNames = [
  "queryOptions",
  "infiniteOptions",
  "metadataOptions",
  "liveOptions",
  "streamedOptions",
] as const;

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
  readonly wrapRunner: <R>(runner: RuntimeInput<R>) => RunPromiseExit<R>;
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
  const pending = new Set<Promise<unknown>>();
  const cancelled = new WeakSet<Promise<unknown>>();
  const queries = new Set<AbortController>();
  const drainFailures: unknown[] = [];
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
    signal?: AbortSignal
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
              Cause.hasInterruptsOnly(error.cause)))
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
  const wrapRunner: QueryOwner<A>["wrapRunner"] = (input) => {
    const runner = resolveRuntime(input);
    return async (effect, options) =>
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
      });
  };
  const wrapLeafExecution = (
    rebuilt: RuntimeUtilityNode
  ): RuntimeUtilityNode => {
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
    const descriptor = readLeafDescriptor(node);
    const base: RuntimeUtilityNode =
      descriptor === undefined
        ? { ...node }
        : // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, typescript/no-unsafe-type-assertion
          ({
            ...descriptor.rebuild(wrapRunner(descriptor.runner)),
          } as RuntimeUtilityNode);
    if (Object.hasOwn(node, "mutationOptions")) {
      base["mutationOptions"] = node["mutationOptions"];
    }
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
    const accepted = [...pending];
    const draining = Promise.allSettled(accepted);
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
