import { Schema } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcGroup, type RpcClient } from 'effect/rpc'

const Read = Rpc.make('users.read', {
  payload: { id: Schema.Int },
  success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  error: Schema.Literal('missing'),
})
const group = RpcGroup.make(Read)
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>
export const rpc = createRpcQueryUtils(group, { client, keyPrefix: ['framework-guide'] })
