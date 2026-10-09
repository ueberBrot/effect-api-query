import { defaultShouldDehydrateQuery, dehydrate, hydrate } from '@tanstack/query-core'
import type { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils } from 'effect-api-query'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Rpc, RpcClient, RpcGroup } from 'effect/rpc'

export const ProfileDto = Schema.Struct({
  name: Schema.String,
  credits: Schema.String,
  avatar: Schema.String.check(Schema.isBase64()),
})

export const dtoGroup = RpcGroup.make(Rpc.make('profile.read', { success: ProfileDto }))
export const dtoApi = HttpApi.make('dto').add(
  HttpApiGroup.make('profile').add(
    HttpApiEndpoint.get('read', '/profile', { success: ProfileDto }),
  ),
)

export function dtoRpcOptions<E>(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof dtoGroup>, E>,
) {
  return createRpcQueryUtils<typeof dtoGroup, readonly ['dto', 'rpc'], E>(dtoGroup, {
    client,
    keyPrefix: ['dto', 'rpc'],
  }).profile.read.queryOptions({ retry: false, staleTime: 60_000 })
}

export function dtoHttpOptions(client: HttpApiClient.ForApi<typeof dtoApi>) {
  return createHttpApiQueryUtils(dtoApi, {
    client,
    keyPrefix: ['dto', 'http'],
  }).profile.read.queryOptions({ retry: false, staleTime: 60_000 })
}

export const snapshotDto = (queryClient: QueryClient): string =>
  JSON.stringify(
    dehydrate(queryClient, {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query) =>
        defaultShouldDehydrateQuery(query) && query.queryKey[0] === 'dto',
    }),
  )

export const hydrateDto = (queryClient: QueryClient, json: string): void =>
  hydrate(queryClient, JSON.parse(json))
