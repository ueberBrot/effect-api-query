import { QueryClient } from '@tanstack/query-core'
import { createRpcQueryUtils } from 'effect-api-query'
import type { RpcClient, RpcGroup } from 'effect/rpc'

import { usersRpc } from './docs-readme-rpc-contract.ts'

async function readUser(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof usersRpc>>,
  queryClient: QueryClient,
) {
  const rpc = createRpcQueryUtils(usersRpc, { client, keyPrefix: ['users-app'] })
  const user = await queryClient.query(rpc.users.get.queryOptions({ input: { id: 1 } }))
  return user.name
}

void readUser
