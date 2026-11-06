import { workflowsApi } from "@effect-api-query/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  configureUtils,
  createHttpApiQueryUtils,
} from "@ueberbrot/effect-api-query";
import { Effect, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

export const startHttpWorkflows = async (baseUrl: string) => {
  const runtime = ManagedRuntime.make(FetchHttpClient.layer);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { networkMode: "always" } },
  });
  const pending = new Set<Promise<unknown>>();
  const consumers = new Set<AbortController>();
  let closing = false;
  let disposal: Promise<void> | undefined;
  const track = async <T>(promise: Promise<T>): Promise<T> => {
    pending.add(promise);
    try {
      return await promise;
    } finally {
      pending.delete(promise);
    }
  };
  const intercept = async <T>({
    next,
  }: {
    readonly next: () => Promise<T>;
  }) => {
    if (closing) {
      throw new Error("The HTTP example has closed");
    }
    return track(next());
  };
  try {
    const client = await runtime.runPromise(
      HttpApiClient.make(workflowsApi, { baseUrl })
    );
    const http = configureUtils(
      createHttpApiQueryUtils(workflowsApi, {
        client,
        keyPrefix: ["http-workflows"],
        runPromiseExit: runtime.runPromiseExit,
      }),
      {
        query: { policy: { retry: false }, interceptors: [intercept] },
        metadata: { policy: { retry: false }, interceptors: [intercept] },
        infinite: { policy: { retry: false }, interceptors: [intercept] },
        live: { policy: { retry: false }, interceptors: [intercept] },
        streamed: {
          policy: {
            retry: false,
            maxChunks: 4,
            publicationBatchSize: 3,
            publicationMaxWaitMs: 180,
          },
          interceptors: [intercept],
        },
        mutation: { policy: { retry: false }, interceptors: [intercept] },
      }
    );
    const drainMutations = Effect.callback<boolean>((resume) => {
      const cache = queryClient.getMutationCache();
      const check = () => {
        if (
          !cache
            .getAll()
            .some((mutation) => mutation.state.status === "pending")
        ) {
          resume(Effect.succeed(true));
        }
      };
      const unsubscribe = cache.subscribe(check);
      check();
      return Effect.sync(unsubscribe);
    });
    return {
      client,
      http,
      queryClient,
      consume<E>(effect: Effect.Effect<void, E>) {
        if (closing) {
          throw new Error("The HTTP example has closed");
        }
        const controller = new AbortController();
        consumers.add(controller);
        const done = track(
          (async () => {
            try {
              await runtime.runPromise(effect, { signal: controller.signal });
            } finally {
              consumers.delete(controller);
            }
          })()
        );
        return {
          done,
          stop: () => {
            controller.abort();
          },
        };
      },
      dispose: async () => {
        disposal ??= (async () => {
          closing = true;
          for (const controller of consumers) {
            controller.abort();
          }
          try {
            await queryClient.cancelQueries();
            await Promise.allSettled(pending);
            await runtime.runPromise(drainMutations);
          } finally {
            queryClient.clear();
            await runtime.dispose();
          }
        })();
        return disposal;
      },
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
};

export type HttpWorkflows = Awaited<ReturnType<typeof startHttpWorkflows>>;
