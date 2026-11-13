import {
  acquireQueryOwner,
  createHttpApiQueryUtils,
  configureUtils,
} from "@ueberbrot/effect-api-query";
import { ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { usersApi } from "./docs-readme-http-contract.ts";

export const startUsersApplication = async (baseUrl: string) => {
  const owner = await acquireQueryOwner(
    async (setup) => {
      const runtime = await setup.acquire(
        () => ManagedRuntime.make(FetchHttpClient.layer),
        async (acquired) => acquired.dispose()
      );
      const client = await runtime.runPromise(
        HttpApiClient.make(usersApi, { baseUrl })
      );
      return configureUtils(
        createHttpApiQueryUtils(usersApi, {
          client,
          keyPrefix: ["users-app"],
          runPromiseExit: setup.wrapRunner(runtime.runPromiseExit),
        }),
        {
          query: {
            interceptors: [
              async ({ next, context }) =>
                await setup.runQuery(next, context.signal),
            ],
          },
        }
      );
    },
    { defaultOptions: { queries: { retry: false } } }
  );
  return {
    http: owner.resources,
    queryClient: owner.queryClient,
    dispose: owner.dispose,
  };
};

export type UsersApplication = Awaited<
  ReturnType<typeof startUsersApplication>
>;
