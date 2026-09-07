import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { FetchHttpClient } from 'effect/unstable/http'
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from 'effect/unstable/rpc'

const User = Schema.Struct({ id: Schema.Int, name: Schema.String })
const usersRpc = RpcGroup.make(
  Rpc.make('users.get', {
    payload: {
      id: Schema.Int,
      locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))),
    },
    success: User,
  }),
  Rpc.make('users.create', {
    payload: { name: Schema.String },
    success: User,
  }),
)

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
