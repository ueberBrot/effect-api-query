import { Effect, Schema } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcClient, RpcGroup } from 'effect/rpc'

const User = Schema.Struct({ id: Schema.Finite, name: Schema.String })
const payload = {
  id: Schema.FiniteFromString,
  locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))),
}
export const usersRpc = RpcGroup.make(
  Rpc.make('users.get', { payload, success: User }),
  Rpc.make('users.watch', { payload, success: User, stream: true }),
  Rpc.make('users.list', { success: Schema.Array(User) }),
  Rpc.make('health.ping', { success: Schema.String }),
)

export const userCacheFilters = <ClientError>(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof usersRpc>, ClientError>,
) => {
  const rpc = createRpcQueryUtils<typeof usersRpc, readonly ['users-app'], ClientError>(usersRpc, {
    client,
    keyPrefix: ['users-app'],
  })
  const queryPrefix = [...rpc.users.get.key(), 'query'] as const
  const historyPrefix = [...rpc.users.watch.key(), 'streamed'] as const

  return {
    rpc,
    root: { queryKey: rpc.key() },
    branch: { queryKey: rpc.users.key() },
    leaf: { queryKey: rpc.users.get.key() },
    query: { queryKey: queryPrefix },
    forId: (id: number) => ({ queryKey: [...queryPrefix, { id: String(id) }] as const }),
    history: { queryKey: historyPrefix },
    historyForId: (id: number) => ({
      queryKey: [...historyPrefix, { id: String(id) }] as const,
    }),
    exact: (id: number, locale = 'en') => ({
      queryKey: rpc.users.get.queryKey({ id, locale }),
      exact: true as const,
    }),
  }
}
