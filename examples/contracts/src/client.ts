import { Effect, Exit, Layer, ManagedRuntime, Predicate, Scope } from 'effect'
import { FetchHttpClient } from 'effect/http'
import type { RpcClientError, RpcGroup } from 'effect/rpc'
import { RpcClient, RpcSerialization } from 'effect/rpc'

import { exampleRpcGroup } from './contracts.ts'
import type { SlowDiagnosticInput } from './contracts.ts'

export type ExampleRpcClient = RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof exampleRpcGroup>,
  RpcClientError.RpcClientError
>

export interface StartedExampleRpcClient {
  readonly client: ExampleRpcClient
  readonly dispose: () => Promise<void>
  readonly runPromiseExit: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Exit.Exit<A, E>>
}

/** Acquires a caller-owned, scoped flat client for the example HTTP server. */
export const makeExampleRpcClient = Effect.fn('ExampleRpc.makeExampleRpcClient')(function* (
  rpcUrl: string,
) {
  const protocolLayer = RpcClient.layerProtocolHttp({ url: rpcUrl }).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
  )

  const client = yield* RpcClient.make(exampleRpcGroup, { flatten: true }).pipe(
    Effect.provide(protocolLayer),
  )
  let nextSlowOperation = 1
  const forwardClient: (...args: Parameters<ExampleRpcClient>) => ReturnType<ExampleRpcClient> =
    client

  const cancellationAwareClient = (
    tag: Parameters<ExampleRpcClient>[0],
    payload: Parameters<ExampleRpcClient>[1],
    options?: Parameters<ExampleRpcClient>[2],
  ) => {
    if (tag !== 'diagnostics.slow') {
      return forwardClient(tag, payload, options)
    }

    // SAFETY: ExampleRpcClient pairs this checked tag with SlowDiagnosticInput;
    // Parameters erases that generic relationship inside the forwarding wrapper.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const slowPayload = payload as SlowDiagnosticInput
    const suppliedOperationId = slowPayload.operationId
    const operationId =
      suppliedOperationId ?? `${globalThis.crypto.randomUUID()}-${String(nextSlowOperation)}`

    if (Predicate.isNullish(suppliedOperationId)) {
      nextSlowOperation += 1
    }

    // The buffered HTTP protocol cannot carry a caller's interruption after sending a request.
    return client('diagnostics.slow', { ...slowPayload, operationId }, options).pipe(
      Effect.onInterrupt(() =>
        client('diagnostics.cancel', { operationId }).pipe(
          Effect.ignoreCause({ log: true, message: 'Failed to cancel example slow operation' }),
        ),
      ),
    )
  }

  // SAFETY: Every tag forwards its original payload/options and result unchanged;
  // the slow tag only adds cancellation while preserving the SDK's generic call signature.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return cancellationAwareClient as ExampleRpcClient
})

/** Starts the ready RPC client resource shared by each executable application. */
export const startExampleRpcClient = async (rpcUrl: string): Promise<StartedExampleRpcClient> => {
  const clientScope = await Effect.runPromise(Scope.make())
  const runtime = ManagedRuntime.make(Layer.empty)
  let disposal: Promise<void> | undefined
  const dispose = async () => {
    disposal ??= (async () => {
      try {
        await runtime.dispose()
      } catch (error) {
        try {
          await Effect.runPromise(Scope.close(clientScope, Exit.void))
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'RPC client cleanup failed', {
            cause: cleanupError,
          })
        }
        throw error
      }
      await Effect.runPromise(Scope.close(clientScope, Exit.void))
    })()
    return disposal
  }

  try {
    const client = await runtime.runPromise(
      makeExampleRpcClient(rpcUrl).pipe(Scope.provide(clientScope)),
    )
    return {
      client,
      dispose,
      runPromiseExit: async (effect, options) =>
        runtime.runPromiseExit(
          RpcClient.withHeaders(effect, {
            'x-example-authorization': 'allowed',
          }),
          options,
        ),
    }
  } catch (error) {
    try {
      await dispose()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'RPC client startup and cleanup failed', {
        cause: cleanupError,
      })
    }
    throw error
  }
}
