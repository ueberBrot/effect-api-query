import { Effect } from 'effect'
import type { Server } from 'node:http'
import { promisify } from 'node:util'

export const closeNodeServer = async (server: Server): Promise<void> => {
  // Node's close method returns its server for chaining; promisify uses the completion callback.
  // oxlint-disable-next-line typescript/strict-void-return
  const closing = promisify(server.close.bind(server))()
  server.closeIdleConnections()
  server.closeAllConnections()
  await closing
}

export const acquireNodeServer = Effect.fn('ExampleRpc.acquireNodeServer')(function* <A, E, R>(
  server: Server,
  acquire: Effect.Effect<A, E, R>,
) {
  return yield* Effect.acquireRelease(acquire, () =>
    Effect.tryPromise(async () => closeNodeServer(server)).pipe(Effect.orDie),
  )
})
