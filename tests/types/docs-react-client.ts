import {
  acquireQueryOwner,
  createHttpApiQueryUtils,
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
      return setup.trackUtils(
        createHttpApiQueryUtils(usersApi, { client, runtime })
      );
    },
    { defaultOptions: { queries: { retry: false } } }
  );
  return owner;
};

export type UsersApplication = Awaited<
  ReturnType<typeof startUsersApplication>
>;
