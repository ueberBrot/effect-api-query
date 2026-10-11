import type { ExampleHost } from '@effect-api-query/server/web-handler'
import { Effect, Exit, Scope } from 'effect'

import { reportCleanupFailure, startTanStackStartApplication } from './application.ts'

export const startServerApplication = async ({
  host,
  identity = 'example',
  authorization,
  signal,
}: {
  readonly host: ExampleHost
  readonly identity?: string
  readonly authorization: string | undefined
  readonly signal?: AbortSignal
}) => {
  signal?.throwIfAborted()
  const scope = Scope.makeUnsafe()
  try {
    const client = await Effect.runPromise(
      host.makeRpcClient(authorization).pipe(Scope.provide(scope)),
    )
    const application = await startTanStackStartApplication({
      rpcUrl: 'http://example.local/rpc',
      identity,
      httpAuthorization: authorization ?? '',
      fetch: async (input, init) => host.handleRequest(new Request(input, init)),
      rpcClient: {
        client,
        runPromiseExit: Effect.runPromiseExit,
        dispose: async () => Effect.runPromise(Scope.close(scope, Exit.void)),
      },
    })
    const dispose = () => {
      void reportCleanupFailure(application.dispose())
    }
    signal?.addEventListener('abort', dispose, { once: true })
    if (signal?.aborted === true) {
      await application.dispose()
      signal.throwIfAborted()
    }
    return {
      ...application,
      dispose: async () => {
        signal?.removeEventListener('abort', dispose)
        await application.dispose()
      },
    }
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void))
    throw error
  }
}
