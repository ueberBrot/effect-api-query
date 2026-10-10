import { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'

export const usersRpc = RpcGroup.make(
  Rpc.make('users.get', {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    error: Schema.TaggedStruct('RetryLater', {}),
  }),
)

export const createApplicationQueries = <ClientError>(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof usersRpc>, ClientError>,
) => {
  const rpc = createRpcQueryUtils<typeof usersRpc, readonly ['users-app'], ClientError>(usersRpc, {
    client,
    keyPrefix: ['users-app'],
  })
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 600_000, retry: false, retryDelay: 250 },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryDefaults(rpc.key(), { staleTime: 60_000 })
  queryClient.setQueryDefaults(rpc.users.key(), { retry: 2 })
  queryClient.setQueryDefaults([...rpc.users.get.key(), 'query'], { staleTime: 120_000 })

  const user = rpc.users.get.queryOptions({
    input: { id: 1 },
    select: (value) => value.name,
  })
  const refreshUser = rpc.users.get.queryOptions({
    input: { id: 1 },
    staleTime: 0,
    retry: false,
  })
  return { queryClient, rpc, user, refreshUser }
}
