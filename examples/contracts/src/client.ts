import { Effect, Exit, Layer, ManagedRuntime, Predicate, Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import type { RpcClientError, RpcGroup } from "effect/rpc";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { exampleRpcGroup } from "./contracts.ts";

export type ExampleRpcClient = RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof exampleRpcGroup>,
  RpcClientError.RpcClientError
>;

export interface StartedExampleRpcClient {
  readonly client: ExampleRpcClient;
  readonly dispose: () => Promise<void>;
  readonly runPromiseExit: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<Exit.Exit<A, E>>;
}

export const makeExampleRpcClient = Effect.fn(
  "ExampleRpc.makeExampleRpcClient"
)(function* (rpcUrl: string) {
  const protocolLayer = RpcClient.layerProtocolHttp({ url: rpcUrl }).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer)
  );

  const client = yield* RpcClient.make(exampleRpcGroup, { flatten: true }).pipe(
    Effect.provide(protocolLayer)
  );
  let nextSlowOperation = 1;
  const forwardClient: (
    ...args: Parameters<ExampleRpcClient>
  ) => ReturnType<ExampleRpcClient> = client;

  type ClientArguments = {
    [Tag in Parameters<ExampleRpcClient>[0]]: Parameters<
      typeof client<Tag, boolean, unknown>
    >;
  }[Parameters<ExampleRpcClient>[0]];

  const cancellationAwareClient = (
    ...[tag, payload, options]: ClientArguments
  ) => {
    if (tag !== "diagnostics.slow") {
      return forwardClient(tag, payload, options);
    }

    const suppliedOperationId = payload.operationId;
    const operationId =
      suppliedOperationId ??
      `${globalThis.crypto.randomUUID()}-${String(nextSlowOperation)}`;

    if (Predicate.isNullish(suppliedOperationId)) {
      nextSlowOperation += 1;
    }

    return client(
      "diagnostics.slow",
      { ...payload, operationId },
      options
    ).pipe(
      Effect.onInterrupt(() =>
        client("diagnostics.cancel", { operationId }).pipe(
          Effect.ignoreCause({
            log: true,
            message: "Failed to cancel example slow operation",
          })
        )
      )
    );
  };

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion
  return cancellationAwareClient as ExampleRpcClient;
});

export const startExampleRpcClient = async (
  rpcUrl: string
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
      makeExampleRpcClient(rpcUrl).pipe(Scope.provide(clientScope))
    );
    return {
      client,
      dispose,
      runPromiseExit: async (effect, options) =>
        runtime.runPromiseExit(
          RpcClient.withHeaders(effect, {
            "x-example-authorization": "allowed",
          }),
          options
        ),
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
