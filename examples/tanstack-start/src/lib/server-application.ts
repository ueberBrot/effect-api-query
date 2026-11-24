import type { ExampleHost } from "@effect-api-query/server/web-handler";
import { Effect, Exit, Scope } from "effect";

import {
  reportCleanupFailure,
  startTanStackStartApplication,
} from "./application.ts";

export const startServerApplication = async ({
  host,
  identity = "example",
  request,
}: {
  readonly host: ExampleHost;
  readonly identity?: string;
  readonly request?: Request;
}) => {
  const signal = request?.signal;
  signal?.throwIfAborted();
  const local = host.forRequest(request);
  const scope = Scope.makeUnsafe();
  try {
    const client = await Effect.runPromise(
      local.makeRpcClient().pipe(Scope.provide(scope))
    );
    const application = await startTanStackStartApplication({
      rpcUrl: "http://example.local/rpc",
      identity,
      fetch: local.fetch,
      rpcClient: {
        client,
        runtime: Effect.runPromiseExit,
        dispose: async () => {
          await Effect.runPromise(Scope.close(scope, Exit.void));
        },
      },
    });
    const dispose = () => {
      void reportCleanupFailure(application.dispose());
    };
    signal?.addEventListener("abort", dispose, { once: true });
    if (signal?.aborted === true) {
      await application.dispose();
      signal.throwIfAborted();
    }
    return {
      ...application,
      dispose: async () => {
        signal?.removeEventListener("abort", dispose);
        await application.dispose();
      },
    };
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw error;
  }
};
