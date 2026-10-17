import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { createRpcQueryUtils } from '@ueberbrot/effect-api-query'
import { Effect, Exit, Layer, Scope } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { RpcClient, RpcSerialization } from 'effect/rpc'

import { usersRpc } from './docs-rpc-quick-start-contract.ts'

const protocol = RpcClient.layerProtocolHttp({ url: 'http://localhost:3000/rpc' }).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer),
)
const scope = await Effect.runPromise(Scope.make())
const queryClient = new QueryClient()

try {
  const client = await Effect.runPromise(
    RpcClient.make(usersRpc, { flatten: true }).pipe(
      Effect.provide(protocol),
      Scope.provide(scope),
    ),
  )
  const rpc = createRpcQueryUtils(usersRpc, {
    client,
    keyPrefix: ['users-app'] as const,
  })

  const user = await queryClient.query(rpc.users.get.queryOptions({ input: { id: 1 } }))
  console.log(user.name)

  const createUser = new MutationObserver(queryClient, rpc.users.create.mutationOptions())
  const created = await createUser.mutate({ name: 'Ada' })
  console.log(created.id)
  await queryClient.invalidateQueries({ queryKey: rpc.users.key() })
} finally {
  try {
    await queryClient.cancelQueries()
  } finally {
    queryClient.clear()
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
}
