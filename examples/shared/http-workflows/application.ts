import { workflowsApi } from "@effect-api-query/contracts";
import {
  acquireQueryOwner,
  defineHttpApiPolicy,
  configureUtils,
  createHttpApiQueryUtils,
} from "@ueberbrot/effect-api-query";
import { Effect, Exit, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

export const startHttpWorkflows = async (baseUrl: string) => {
  const owner = await acquireQueryOwner(
    async (setup) => {
      const runtime = await setup.acquire(
        () => ManagedRuntime.make(FetchHttpClient.layer),
        async (acquired) => acquired.dispose()
      );
      const client = await runtime.runPromise(
        HttpApiClient.make(workflowsApi, { baseUrl })
      );
      const base = createHttpApiQueryUtils(workflowsApi, {
        client,
        keyPrefix: ["http-workflows"],
        runtime,
      });
      const policy = defineHttpApiPolicy(workflowsApi, {
        query: { retry: false },
        metadata: { retry: false },
        infinite: { retry: false },
        live: {
          retry: false,
          coalesceMs: 250,
        },
        streamed: {
          retry: false,
          maxChunks: 4,
          publicationBatchSize: 3,
          publicationMaxWaitMs: 180,
        },
        mutation: { retry: false },
      });
      return {
        runtime,
        client,
        run: setup.wrapRunner(runtime),
        http: setup.trackUtils(configureUtils(base, policy)),
      };
    },
    {
      defaultOptions: { mutations: { networkMode: "always" } },
    }
  );
  const { queryClient } = owner;
  const { runtime, client, run, http } = owner.resources;
  const drainMutations = Effect.callback<boolean>((resume) => {
    const cache = queryClient.getMutationCache();
    const check = () => {
      if (
        !cache.getAll().some((mutation) => mutation.state.status === "pending")
      ) {
        resume(Effect.succeed(true));
      }
    };
    const unsubscribe = cache.subscribe(check);
    check();
    return Effect.sync(unsubscribe);
  });
  return {
    owner,
    client,
    http,
    queryClient,
    consume<E>(effect: Effect.Effect<void, E>) {
      if (!owner.isActive()) {
        throw new Error("The HTTP example has closed");
      }
      const controller = new AbortController();
      const done = (async () => {
        const exit = await run(effect, {
          signal: controller.signal,
        });
        if (Exit.isFailure(exit)) {
          await Effect.runPromise(Effect.failCause(exit.cause));
        }
      })();
      return {
        done,
        stop: () => {
          controller.abort();
        },
      };
    },
    // oxlint-disable-next-line typescript/promise-function-async
    dispose: () => {
      if (owner.isActive()) {
        void Promise.allSettled([
          owner.runMutation(async () => runtime.runPromise(drainMutations)),
        ]);
      }
      return owner.dispose();
    },
  };
};

export type HttpWorkflows = Awaited<ReturnType<typeof startHttpWorkflows>>;
