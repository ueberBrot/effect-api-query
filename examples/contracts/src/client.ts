import { Effect, Exit, Layer, ManagedRuntime, Scope } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { RpcClient, RpcClientError, RpcGroup, RpcSerialization } from 'effect/rpc'

import { exampleRpcGroup, type SlowDiagnosticInput } from './contracts.ts'

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

  return ((tag: string, payload: unknown, options?: unknown) => {
    if (tag !== 'diagnostics.slow') {
      return Reflect.apply(client, undefined, [tag, payload, options])
    }

    const slowPayload = payload as SlowDiagnosticInput
    const operationId =
      slowPayload.operationId ?? `${globalThis.crypto.randomUUID()}-${String(nextSlowOperation++)}`

    // The buffered HTTP protocol cannot carry a caller's interruption after sending a request.
    return client('diagnostics.slow', { ...slowPayload, operationId }, options as never).pipe(
      Effect.onInterrupt(() =>
        client('diagnostics.cancel', { operationId }).pipe(
          Effect.ignoreCause({ log: true, message: 'Failed to cancel example slow operation' }),
        ),
      ),
    )
  }) as ExampleRpcClient
})

/** Starts the ready RPC client resource shared by each executable application. */
export const startExampleRpcClient = async (rpcUrl: string): Promise<StartedExampleRpcClient> => {
  const clientScope = await Effect.runPromise(Scope.make())
  const runtime = ManagedRuntime.make(Layer.empty)
  let disposal: Promise<void> | undefined
  const dispose = () => {
    disposal ??= (async () => {
      try {
        await runtime.dispose()
      } catch (cause) {
        try {
          await Effect.runPromise(Scope.close(clientScope, Exit.void))
        } catch (cleanupCause) {
          throw new AggregateError([cause, cleanupCause], 'RPC client cleanup failed')
        }
        throw cause
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
      runPromiseExit: (effect, options) =>
        runtime.runPromiseExit(
          RpcClient.withHeaders(effect, {
            'x-example-authorization': 'allowed',
          }),
          options,
        ),
    }
  } catch (cause) {
    try {
      await dispose()
    } catch (cleanupCause) {
      throw new AggregateError([cause, cleanupCause], 'RPC client startup and cleanup failed')
    }
    throw cause
  }
}
