import { QueryClient } from '@tanstack/query-core'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'

export const socketGroup = RpcGroup.make(
  Rpc.make('values.read', { payload: { id: Schema.Int }, success: Schema.Int }),
  Rpc.make('values.watch', {
    payload: { channel: Schema.String },
    success: Schema.Int,
    stream: true,
  }),
)

export const acquireSocketQueries = Effect.fn('acquireSocketQueries')(function* (
  url: string,
  owner: string,
) {
  const clientScope = yield* Scope.fork(yield* Effect.scope, 'sequential')
  const socket = yield* Socket.makeWebSocket(url).pipe(Scope.provide(clientScope))
  const protocol = yield* Layer.buildWithScope(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(Layer.succeed(Socket.Socket, socket)),
    ),
    clientScope,
  )
  const client = yield* RpcClient.make(socketGroup, { flatten: true }).pipe(
    Effect.provide(protocol),
    Scope.provide(clientScope),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rpc = createRpcQueryUtils(socketGroup, { client, keyPrefix: ['socket', owner] })
  yield* Scope.addFinalizer(
    clientScope,
    Effect.promise(async () => {
      await queryClient.cancelQueries()
      queryClient.clear()
    }),
  )
  return { client, rpc, queryClient, dispose: Scope.close(clientScope, Exit.void) }
})
