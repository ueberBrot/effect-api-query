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
      const runPromiseExit = setup.wrapRunner(runtime.runPromiseExit);
      const intercept = async <T>({
        next,
        context,
      }: {
        readonly next: () => Promise<T>;
        readonly context: { readonly signal: AbortSignal };
      }) => await setup.runQuery(next, context.signal);
      const base = createHttpApiQueryUtils(workflowsApi, {
        client,
        keyPrefix: ["http-workflows"],
        runtime: runPromiseExit,
      });
      const policy = defineHttpApiPolicy(workflowsApi, {
        query: { retry: false, interceptors: [intercept] },
        metadata: { retry: false, interceptors: [intercept] },
        infinite: { retry: false, interceptors: [intercept] },
        live: {
          retry: false,
          coalesceMs: 250,
          interceptors: [intercept],
        },
        streamed: {
          retry: false,
          maxChunks: 4,
          publicationBatchSize: 3,
          publicationMaxWaitMs: 180,
          interceptors: [intercept],
        },
        mutation: { retry: false },
      });
      return {
        runtime,
        client,
        runPromiseExit,
        http: configureUtils(base, policy),
      };
    },
    {
      defaultOptions: { mutations: { networkMode: "always" } },
    }
  );
  const { queryClient } = owner;
  const { runtime, client, runPromiseExit, http } = owner.resources;
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
        const exit = await runPromiseExit(effect, {
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
    // Preserve the owner's idempotent disposal promise.
    // oxlint-disable-next-line typescript/promise-function-async
    dispose: () => {
      if (owner.isActive()) {
        // The owner reports this registered drain's failures through disposal.
        void Promise.allSettled([
          owner.runMutation(async () => runtime.runPromise(drainMutations)),
        ]);
      }
      return owner.dispose();
    },
  };
};

export type HttpWorkflows = Awaited<ReturnType<typeof startHttpWorkflows>>;
