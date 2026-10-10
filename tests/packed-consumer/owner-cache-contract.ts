import type { MutationOptions, QueryClient } from '@tanstack/react-query'
import type { Schema } from 'effect'
import type { EffectRpcQueryError } from 'effect-api-query'
import type { HttpApiClient } from 'effect/http-api'
import type { RpcClient, RpcClientError, RpcGroup } from 'effect/rpc'

import { DirectoryUser, makeOwnerQueries, ownerApi, ownerGroup } from './docs-owner-cache.ts'
import { ownerKeyPrefix } from './owner-cache.ts'
import type { ApplicationOwnerIdentity } from './owner-cache.ts'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

declare const rpcClient: RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof ownerGroup>,
  RpcClientError.RpcClientError
>
declare const httpClient: HttpApiClient.ForApi<typeof ownerApi>
declare const identity: ApplicationOwnerIdentity

const application = makeOwnerQueries({ rpcClient, httpClient, identity })
const rpcData = application.queryClient.getQueryData(application.rpc.users.list.queryKey())
const httpData = application.queryClient.getQueryData(application.http.users.list.queryKey())
application.createUser satisfies MutationOptions<
  typeof DirectoryUser.Type,
  EffectRpcQueryError<RpcClientError.RpcClientError>,
  { readonly name: string },
  undefined
>
application.queryClient satisfies QueryClient

type Contract = [
  Assert<
    Equal<
      ReturnType<typeof ownerKeyPrefix>,
      readonly ['vite-react', string, string, number, number]
    >
  >,
  Assert<Equal<typeof rpcData, readonly (typeof DirectoryUser.Type)[] | undefined>>,
  Assert<Equal<typeof httpData, readonly (typeof DirectoryUser.Type)[] | undefined>>,
  Assert<
    Equal<
      Schema.Schema.Type<typeof DirectoryUser>,
      { readonly id: number; readonly name: string; readonly locale: string }
    >
  >,
]
declare const contract: Contract
contract satisfies [true, true, true, true]

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
