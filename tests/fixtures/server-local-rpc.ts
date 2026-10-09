import { Deferred, Effect } from 'effect'
import type { Rpc, RpcGroup, RpcMessage } from 'effect/rpc'
import { RpcClient, RpcServer } from 'effect/rpc'

/** Bounded application recipe, outside the published library contract. */
export const makeServerLocalRpcClient = Effect.fnUntraced(function* <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
) {
  const reply =
    yield* Deferred.make<(message: RpcMessage.FromServer<Rpcs>) => Effect.Effect<void>>()
  const server = yield* RpcServer.makeNoSerialization(group, {
    disableFatalDefects: true,
    onFromServer: (response) =>
      Deferred.await(reply).pipe(Effect.flatMap((write) => write(response))),
  })
  const { client, write } = yield* RpcClient.makeNoSerialization(group, {
    flatten: true,
    supportsAck: true,
    onFromClient: ({ message }) => server.write(0, message),
  })
  yield* Deferred.succeed(reply, write)
  return client
})
