import { exampleHttpApi, exampleRpcGroup } from "@effect-api-query/contracts";
import { startExampleRpcClient } from "@effect-api-query/contracts/client";
import type { ExampleRpcClient } from "@effect-api-query/contracts/client";
import type { QueryClient } from "@tanstack/react-query";
import {
  acquireQueryOwner,
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
} from "@ueberbrot/effect-api-query";
import type { QueryOwner, RunPromiseExit } from "@ueberbrot/effect-api-query";
import { ManagedRuntime } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import type { RpcClientError } from "effect/rpc";

import { makeOwnerCache, ownerKeyPrefix } from "./owner-cache.ts";
import type {
  ApplicationOwnerIdentity,
  DirectoryStorage,
} from "./owner-cache.ts";
import { makeUsersInvalidator, makeUserWrites } from "./user-writes.ts";

const queryRetirementConfiguration = (
  runQuery: QueryOwner<unknown>["runQuery"]
) => {
  const intercept = async <T>({
    next,
    context,
  }: {
    readonly next: () => Promise<T>;
    readonly context: { readonly signal: AbortSignal };
  }) => await runQuery(next, context.signal);
  const query = { interceptors: [intercept] };
  return { query, infinite: query, live: query, streamed: query };
};

const makeExampleRpcQueryUtils = (
  client: ExampleRpcClient,
  runPromiseExit: RunPromiseExit,
  keyPrefix: ReturnType<typeof ownerKeyPrefix>,
  runQuery: QueryOwner<unknown>["runQuery"]
) =>
  configureUtils(
    createRpcQueryUtils<
      typeof exampleRpcGroup,
      ReturnType<typeof ownerKeyPrefix>,
      RpcClientError.RpcClientError
    >(exampleRpcGroup, {
      client,
      keyPrefix,
      runPromiseExit,
    }),
    queryRetirementConfiguration(runQuery)
  );

export type ExampleRpcQueryUtils = ReturnType<typeof makeExampleRpcQueryUtils>;

const makeExampleHttpQueryUtils = (
  client: HttpApiClient.ForApi<typeof exampleHttpApi>,
  runPromiseExit: RunPromiseExit,
  keyPrefix: ReturnType<typeof ownerKeyPrefix>,
  runQuery: QueryOwner<unknown>["runQuery"]
) =>
  configureUtils(
    createHttpApiQueryUtils(exampleHttpApi, {
      client,
      keyPrefix,
      runPromiseExit,
    }),
    queryRetirementConfiguration(runQuery)
  );

export type ExampleHttpQueryUtils = ReturnType<
  typeof makeExampleHttpQueryUtils
>;

export interface ViteReactApplication {
  readonly httpQuery: ExampleHttpQueryUtils;
  readonly userWrites: ReturnType<typeof makeUserWrites>;
  readonly invalidateUsers: () => Promise<void>;
  readonly dispose: (options?: {
    readonly discardPersistence?: boolean;
  }) => Promise<void>;
  readonly identity: ApplicationOwnerIdentity;
  readonly isActive: () => boolean;
  readonly persistDirectory: () => void;
  readonly runMutation: <T>(execute: () => Promise<T>) => Promise<T>;
  readonly trackMutationOptions: ReturnType<
    typeof makeOwnerCache
  >["trackMutationOptions"];
  readonly queryClient: QueryClient;
  readonly rpcQuery: ExampleRpcQueryUtils;
}

export interface StartViteReactApplicationOptions {
  readonly rpcUrl: string;
  readonly httpBaseUrl?: string;
  readonly identity?: ApplicationOwnerIdentity;
  readonly directoryStorage?: DirectoryStorage;
}

export const startViteReactApplication = async ({
  rpcUrl,
  httpBaseUrl = new URL(rpcUrl, globalThis.location?.href).origin,
  identity = {
    tenantId: "example-team",
    userId: "example-user",
    sessionGeneration: 1,
    permissionGeneration: 1,
  },
  directoryStorage,
}: StartViteReactApplicationOptions): Promise<ViteReactApplication> => {
  const keyPrefix = ownerKeyPrefix(identity);
  const capturedIdentity = Object.freeze({
    tenantId: keyPrefix[1],
    userId: keyPrefix[2],
    sessionGeneration: keyPrefix[3],
    permissionGeneration: keyPrefix[4],
  });
  const lifecycle = await acquireQueryOwner(
    async (setup) => {
      const rpcClient = await setup.acquire(
        async () => startExampleRpcClient(rpcUrl),
        async (acquired) => acquired.dispose()
      );
      const httpRuntime = await setup.acquire(
        () => ManagedRuntime.make(FetchHttpClient.layer),
        async (acquired) => acquired.dispose()
      );
      const httpClient = await httpRuntime.runPromise(
        HttpApiClient.make(exampleHttpApi, {
          baseUrl: httpBaseUrl,
          transformClient: HttpClient.mapRequest(
            HttpClientRequest.setHeader("x-example-authorization", "allowed")
          ),
        })
      );
      return { rpcClient, httpRuntime, httpClient };
    },
    {
      defaultOptions: {
        mutations: { retry: false, networkMode: "always" },
        queries: { retry: false },
      },
    }
  );
  const { rpcClient, httpRuntime, httpClient } = lifecycle.resources;
  const { queryClient } = lifecycle;
  let owner: ReturnType<typeof makeOwnerCache> | undefined;
  let disposal: Promise<void> | undefined;
  const dispose = async (options?: {
    readonly discardPersistence?: boolean;
  }) => {
    const retirement =
      owner === undefined ? queryClient.cancelQueries() : owner.retire(options);
    if (disposal !== undefined) {
      try {
        await retirement;
      } finally {
        await disposal;
      }
      return;
    }
    disposal = (async () => {
      try {
        await retirement;
      } finally {
        await lifecycle.dispose();
      }
    })();
    await disposal;
  };

  try {
    const httpQuery = makeExampleHttpQueryUtils(
      httpClient,
      lifecycle.wrapRunner(httpRuntime.runPromiseExit),
      keyPrefix,
      lifecycle.runQuery
    );
    const rpcQuery = makeExampleRpcQueryUtils(
      rpcClient.client,
      lifecycle.wrapRunner(rpcClient.runPromiseExit),
      keyPrefix,
      lifecycle.runQuery
    );
    owner = makeOwnerCache({
      identity: capturedIdentity,
      queryClient,
      directoryKeys: {
        rpc: rpcQuery.users.list.queryKey(),
        http: httpQuery.users.list.queryKey(),
      },
      storage: directoryStorage,
    });
    owner.restoreDirectory();
    const capturedOwner = owner;
    const invalidateUsers = makeUsersInvalidator({
      queryClient,
      rpcQuery,
      httpQuery,
      isActive: capturedOwner.isActive,
    });
    return {
      httpQuery,
      identity: capturedOwner.identity,
      isActive: capturedOwner.isActive,
      persistDirectory: capturedOwner.persistDirectory,
      runMutation: async (execute) =>
        lifecycle.runMutation(async () => capturedOwner.runMutation(execute)),
      trackMutationOptions: capturedOwner.trackMutationOptions,
      userWrites: makeUserWrites({
        queryClient,
        rpcQuery,
        httpQuery,
        isActive: capturedOwner.isActive,
        invalidateUsers,
        trackMutationOptions: capturedOwner.trackMutationOptions,
      }),
      invalidateUsers,
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
