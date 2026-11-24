import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import type { RpcClientError, RpcGroup } from "effect/rpc";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { exampleRpcGroup, OperationNotFound } from "./contracts.ts";

export type ExampleRpcClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof exampleRpcGroup>,
  RpcClientError.RpcClientError
>;

export interface StartedExampleRpcClient {
  readonly client: ExampleRpcClient;
  readonly dispose: () => Promise<void>;
  readonly runtime: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<Exit.Exit<A, E>>;
}

export const makeExampleFetchLayer = (fetch?: typeof globalThis.fetch) =>
  fetch === undefined
    ? FetchHttpClient.layer
    : FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
      );

export const makeExampleRpcClient = Effect.fn(
  "ExampleRpc.makeExampleRpcClient"
)(function* (rpcUrl: string, fetch?: typeof globalThis.fetch) {
  const protocolLayer = RpcClient.layerProtocolHttp({ url: rpcUrl }).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(makeExampleFetchLayer(fetch))
  );

  const client = yield* RpcClient.make(exampleRpcGroup).pipe(
    Effect.provide(protocolLayer)
  );
  const slow: ExampleRpcClient["diagnostics.slow"] = (payload, options) => {
    const operationId = payload.operationId ?? globalThis.crypto.randomUUID();

    return client["diagnostics.slow"](
      { ...payload, operationId },
      options
    ).pipe(
      Effect.onInterrupt(() =>
        client["diagnostics.cancel"]({ operationId }).pipe(
          Effect.catchIf(
            (error) => error === OperationNotFound.literal,
            () => Effect.void
          ),
          Effect.ignoreCause({
            log: true,
            message: "Failed to cancel example slow operation",
          })
        )
      )
    );
  };

  return { ...client, "diagnostics.slow": slow };
});

export const startExampleRpcClient = async (
  rpcUrl: string,
  fetch?: typeof globalThis.fetch
): Promise<StartedExampleRpcClient> => {
  const clientScope = await Effect.runPromise(Scope.make());
  const runtime = ManagedRuntime.make(Layer.empty);
  let disposal: Promise<void> | undefined;
  const dispose = async () => {
    disposal ??= (async () => {
      try {
        await runtime.dispose();
      } catch (error) {
        try {
          await Effect.runPromise(Scope.close(clientScope, Exit.void));
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "RPC client cleanup failed",
            {
              cause: cleanupError,
            }
          );
        }
        throw error;
      }
      await Effect.runPromise(Scope.close(clientScope, Exit.void));
    })();
    await disposal;
  };

  try {
    const client = await runtime.runPromise(
      makeExampleRpcClient(rpcUrl, fetch).pipe(Scope.provide(clientScope))
    );
    return {
      client,
      dispose,
      runtime: runtime.runPromiseExit,
    };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "RPC client startup and cleanup failed",
        {
          cause: cleanupError,
        }
      );
    }
    throw error;
  }
};
