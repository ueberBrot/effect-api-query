import { QueryClient } from "@tanstack/react-query";
import { createHttpApiQueryUtils } from "@ueberbrot/effect-api-query";
import type { RunPromiseExit } from "@ueberbrot/effect-api-query";
import { ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { usersApi } from "./docs-readme-http-contract.ts";

export const startUsersApplication = async (baseUrl: string) => {
  const runtime = ManagedRuntime.make(FetchHttpClient.layer);
  const running = new Set<Promise<unknown>>();
  const runPromiseExit: RunPromiseExit = (effect, options) => {
    const pending = runtime.runPromiseExit(effect, options);
    running.add(pending);
    void pending.then(
      () => running.delete(pending),
      () => running.delete(pending)
    );
    return pending;
  };
  try {
    const client = await runtime.runPromise(
      HttpApiClient.make(usersApi, { baseUrl })
    );
    const queryClient = new QueryClient();
    const http = createHttpApiQueryUtils(usersApi, {
      client,
      keyPrefix: ["users-app"],
      runPromiseExit,
    });
    return {
      http,
      queryClient,
      dispose: async () => {
        try {
          await queryClient.cancelQueries();
        } finally {
          try {
            await Promise.allSettled([...running]);
          } finally {
            queryClient.clear();
            await runtime.dispose();
          }
        }
      },
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
};

export type UsersApplication = Awaited<
  ReturnType<typeof startUsersApplication>
>;
