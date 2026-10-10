import type { MutationOptions, QueryClient } from '@tanstack/react-query'
import type { Schema } from 'effect'
import type { HttpApiClient } from 'effect/http-api'
import type { RpcClient, RpcGroup } from 'effect/rpc'

import { DirectoryUser, makeOwnerQueries, ownerApi, ownerGroup } from './docs-owner-cache.ts'
import { ownerKeyPrefix } from './owner-cache.ts'
import type { ApplicationOwnerIdentity } from './owner-cache.ts'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

export type OwnerPrefixProof = Assert<
  Equal<ReturnType<typeof ownerKeyPrefix>, readonly ['vite-react', string, string, number, number]>
>

export const ownerContract = <RpcError>(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof ownerGroup>, RpcError>,
  httpClient: HttpApiClient.ForApi<typeof ownerApi>,
  identity: ApplicationOwnerIdentity,
) => {
  const application = makeOwnerQueries({ rpcClient: client, httpClient, identity })
  const rpcData: readonly (typeof DirectoryUser.Type)[] | undefined =
    application.queryClient.getQueryData(application.rpc.users.list.queryKey())
  const httpData: readonly (typeof DirectoryUser.Type)[] | undefined =
    application.queryClient.getQueryData(application.http.users.list.queryKey())
  const mutation: MutationOptions<typeof DirectoryUser.Type, unknown, { readonly name: string }> =
    application.createUser
  const queryClient: QueryClient = application.queryClient
  return { rpcData, httpData, mutation, queryClient }
}

export type PersistedDtoProof = Assert<
  Equal<
    Schema.Schema.Type<typeof DirectoryUser>,
    { readonly id: number; readonly name: string; readonly locale: string }
  >
>

if (false) {
  ownerKeyPrefix({
    tenantId: 'team',
    userId: 'user',
    sessionGeneration: 1,
    permissionGeneration: 1,
    // @ts-expect-error Credentials are not an owner identity field.
    bearer: 'credential',
  })
  ownerKeyPrefix({
    tenantId: 'team',
    userId: 'user',
    sessionGeneration: 1,
    // @ts-expect-error Permission generations are numeric safe identities.
    permissionGeneration: 'token',
  })
}
