import { NodeHttpServer, NodeSocket } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import type { Scope, Stream } from 'effect'
import { RpcSerialization, RpcServer } from 'effect/rpc'
import type { Socket } from 'effect/socket'
import { createServer } from 'node:http'

import { socketGroup } from '../../../../tests/packed-consumer/socket-client.ts'

export const serveSocketGroup = Effect.fn('serveSocketGroup')(function* (handlers: {
  readonly 'values.read': (input: { readonly id: number }) => Effect.Effect<number>
  readonly 'values.watch': (input: { readonly channel: string }) => Stream.Stream<number>
}) {
  const server = yield* NodeHttpServer.make(createServer, {
    host: '127.0.0.1',
    port: 0,
    disablePreemptiveShutdown: true,
  })
  if (server.address._tag === 'UnixPathAddress') {
    return yield* Effect.die(new Error('Expected TCP address'))
  }
  const app = yield* RpcServer.toHttpEffectWebsocket(socketGroup).pipe(
    Effect.provide(Layer.merge(socketGroup.toLayer(handlers), RpcSerialization.layerJson)),
  )
  yield* server.serve(app)
  return `ws://127.0.0.1:${String(server.address.port)}/rpc`
})

export const runSocketCase = async <A, E>(
  effect: Effect.Effect<A, E, Scope.Scope | Socket.WebSocketConstructor>,
) =>
  await Effect.runPromise(
    effect.pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS), Effect.scoped),
  )
