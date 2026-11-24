import { exampleHttpApi, exampleRpcGroup } from "@effect-api-query/contracts";
import { startExampleRpcClient } from "@effect-api-query/contracts/client";
import type {
  ExampleRpcClient,
  StartedExampleRpcClient,
} from "@effect-api-query/contracts/client";
import { QueryClient } from "@tanstack/react-query";
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  fetchStreamSnapshot,
} from "@ueberbrot/effect-api-query";
import type { RunPromiseExit } from "@ueberbrot/effect-api-query";
import { Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

type StartKeyPrefix = readonly ["tanstack-start", string];

const makeExampleRpcQueryUtils = (
  client: ExampleRpcClient,
  runtime: RunPromiseExit,
  keyPrefix: StartKeyPrefix
) =>
  createRpcQueryUtils(exampleRpcGroup, {
    client,
    keyPrefix,
    runtime,
  });

export type ExampleRpcQueryUtils = ReturnType<typeof makeExampleRpcQueryUtils>;

const makeExampleHttpQueryUtils = (
  client: HttpApiClient.ForApi<typeof exampleHttpApi>,
  runtime: RunPromiseExit,
  keyPrefix: StartKeyPrefix
) =>
  createHttpApiQueryUtils(exampleHttpApi, {
    client,
    keyPrefix,
    runtime,
  });

export interface TanStackStartApplication {
  readonly keyPrefix: readonly ["tanstack-start", string];
  readonly runPreparation: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly captureSnapshot: typeof fetchStreamSnapshot;
  readonly httpQuery: ReturnType<typeof makeExampleHttpQueryUtils>;
  readonly invalidateUsers: () => Promise<void>;
  readonly dispose: () => Promise<void>;
  readonly queryClient: QueryClient;
  readonly rpcQuery: ExampleRpcQueryUtils;
}

export interface StartTanStackStartApplicationOptions {
  readonly rpcUrl: string;
  readonly rpcClient?: StartedExampleRpcClient;
  readonly fetch?: typeof globalThis.fetch;
  readonly httpBaseUrl?: string;
  readonly identity?: string;
}

export const startTanStackStartApplication = async ({
  rpcUrl,
  rpcClient: readyRpcClient,
  fetch: applicationFetch,
  identity = "example",
  httpBaseUrl = new URL(rpcUrl, globalThis.location?.href).origin,
}: StartTanStackStartApplicationOptions): Promise<TanStackStartApplication> => {
  const rpcClient =
    readyRpcClient ?? (await startExampleRpcClient(rpcUrl, applicationFetch));
  const httpRuntime = ManagedRuntime.make(
    applicationFetch === undefined
      ? FetchHttpClient.layer
      : FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.Fetch, applicationFetch))
        )
  );
  const keyPrefix: StartKeyPrefix = ["tanstack-start", identity];
  const abort = new AbortController();
  const pendingWork = new Set<Promise<unknown>>();
  const trackWork = async <A>(execute: () => A | Promise<A>): Promise<A> => {
    abort.signal.throwIfAborted();
    const execution = Promise.resolve(execute());
    pendingWork.add(execution);
    try {
      return await execution;
    } finally {
      pendingWork.delete(execution);
    }
  };
  const ownRunner =
    (runner: RunPromiseExit): RunPromiseExit =>
    async (effect, options) =>
      trackWork(async () =>
        runner(
          effect,
          options?.signal === undefined
            ? options
            : { signal: AbortSignal.any([abort.signal, options.signal]) }
        )
      );
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        retry: false,
        staleTime: 60_000,
        persister: async (queryFn, context) =>
          trackWork(() => queryFn(context)),
      },
    },
  });
  const runPreparation: TanStackStartApplication["runPreparation"] = async (
    effect
  ) =>
    trackWork(async () => Effect.runPromise(effect, { signal: abort.signal }));
  const captureSnapshot: typeof fetchStreamSnapshot = async (
    owner,
    options,
    controls = {}
  ) => {
    if (owner !== queryClient) {
      throw new Error("Snapshot belongs to another request");
    }
    return trackWork(async () =>
      fetchStreamSnapshot(owner, options, {
        ...controls,
        signal:
          controls.signal === undefined
            ? abort.signal
            : AbortSignal.any([abort.signal, controls.signal]),
      })
    );
  };
  let disposal: Promise<void> | undefined;
  const dispose = async () => {
    disposal ??= (async () => {
      try {
        try {
          abort.abort();
          await queryClient.cancelQueries();
        } finally {
          await Promise.allSettled(pendingWork);
        }
      } finally {
        try {
          queryClient.clear();
        } finally {
          try {
            await httpRuntime.dispose();
          } finally {
            await rpcClient.dispose();
          }
        }
      }
    })();
    await disposal;
  };

  try {
    const httpClient = await httpRuntime.runPromise(
      HttpApiClient.make(exampleHttpApi, {
        baseUrl: httpBaseUrl,
      })
    );
    const httpQuery = makeExampleHttpQueryUtils(
      httpClient,
      ownRunner(httpRuntime.runPromiseExit),
      keyPrefix
    );
    const rpcQuery = makeExampleRpcQueryUtils(
      rpcClient.client,
      ownRunner(rpcClient.runtime),
      keyPrefix
    );
    return {
      keyPrefix,
      captureSnapshot,
      runPreparation,
      httpQuery,
      invalidateUsers: async () => {
        await Promise.all([
          queryClient.invalidateQueries(rpcQuery.users.queryFilter()),
          queryClient.invalidateQueries(httpQuery.users.queryFilter()),
        ]);
      },
      dispose,
      queryClient,
      rpcQuery,
    };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Application startup and cleanup failed",
        {
          cause: cleanupError,
        }
      );
    }
    throw error;
  }
};

export const reportCleanupFailure = async (
  cleanup: Promise<void>
): Promise<void> => {
  try {
    await cleanup;
  } catch (error) {
    console.error("Start resource cleanup failed", error);
  }
};
