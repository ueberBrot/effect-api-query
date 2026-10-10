import { QueryClient } from '@tanstack/react-query'
import { Effect, Schema } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils } from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import type { HttpApiClient } from 'effect/http-api'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'

import { makeOwnerCache, ownerKeyPrefix } from './owner-cache.ts'
import type { ApplicationOwnerIdentity, DirectoryStorage } from './owner-cache.ts'

export const DirectoryUser = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  locale: Schema.String,
})

export const ownerGroup = RpcGroup.make(
  Rpc.make('users.list', { success: Schema.Array(DirectoryUser) }),
  Rpc.make('users.get', { payload: { id: Schema.Int }, success: DirectoryUser }),
  Rpc.make('users.create', {
    payload: { name: Schema.String },
    success: DirectoryUser,
  }),
  Rpc.make('users.watch', { success: Schema.String, stream: true }),
)

export const ownerApi = HttpApi.make('owner-directory').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('list', '/users', { success: Schema.Array(DirectoryUser) }),
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      success: DirectoryUser,
    }),
    HttpApiEndpoint.post('create', '/users', {
      payload: { name: Schema.String },
      success: DirectoryUser,
    }),
  ),
)

export const makeOwnerQueries = <RpcError>({
  rpcClient,
  httpClient,
  identity,
  storage,
  runPromiseExit = Effect.runPromiseExit,
}: {
  readonly rpcClient: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof ownerGroup>, RpcError>
  readonly httpClient: HttpApiClient.ForApi<typeof ownerApi>
  readonly identity: ApplicationOwnerIdentity
  readonly storage?: DirectoryStorage
  readonly runPromiseExit?: RunPromiseExit
}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, networkMode: 'always' },
    },
  })
  const keyPrefix = ownerKeyPrefix(identity)
  const rpc = createRpcQueryUtils<typeof ownerGroup, typeof keyPrefix, RpcError>(ownerGroup, {
    client: rpcClient,
    keyPrefix,
    runPromiseExit,
  })
  const http = createHttpApiQueryUtils(ownerApi, { client: httpClient, keyPrefix, runPromiseExit })
  const owner = makeOwnerCache({
    identity,
    queryClient,
    directoryKeys: { rpc: rpc.users.list.queryKey(), http: http.users.list.queryKey() },
    storage,
  })
  owner.restoreDirectory()
  const invalidateUsers = async () => {
    if (!owner.isActive()) {
      return
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: rpc.users.key() }),
      queryClient.invalidateQueries({ queryKey: http.users.key() }),
    ])
  }
  const createUser = owner.trackMutationOptions(
    rpc.users.create.mutationOptions({
      onSuccess: async (user) => {
        if (!owner.isActive()) {
          return
        }
        queryClient.setQueryData(rpc.users.get.queryKey({ id: user.id }), user)
        await invalidateUsers()
      },
      onSettled: invalidateUsers,
    }),
  )
  return { owner, queryClient, rpc, http, createUser, invalidateUsers }
}
