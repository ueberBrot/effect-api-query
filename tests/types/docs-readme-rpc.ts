import { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'

const usersRpc = RpcGroup.make(
  Rpc.make('users.get', {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  }),
)

async function readUser(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof usersRpc>>,
  queryClient: QueryClient,
) {
  const rpc = createRpcQueryUtils(usersRpc, { client, keyPrefix: ['users-app'] })
  const user = await queryClient.query(rpc.users.get.queryOptions({ input: { id: 1 } }))
  return user.name
}

void readUser
