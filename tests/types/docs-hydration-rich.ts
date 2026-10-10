import { defaultShouldDehydrateQuery, dehydrate, hydrate } from '@tanstack/query-core'
import type { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils } from 'effect-api-query'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Rpc, RpcClient, RpcGroup } from 'effect/rpc'

export class Profile extends Schema.Class<Profile>('Profile')({
  name: Schema.String,
  credits: Schema.BigIntFromString,
  avatar: Schema.Uint8ArrayFromBase64,
}) {
  summary(): string {
    return `${this.name}: ${this.credits} credits`
  }
}

const profileGroup = RpcGroup.make(
  Rpc.make('profile.read', { success: Profile, error: Schema.String }),
)
const profileApi = HttpApi.make('rich').add(
  HttpApiGroup.make('profile').add(
    HttpApiEndpoint.get('read', '/profile', { success: Profile, error: Schema.String }),
  ),
)

function profileRpcOptions<E>(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof profileGroup>, E>,
) {
  return createRpcQueryUtils<typeof profileGroup, readonly ['profile', 'rpc'], E>(profileGroup, {
    client,
    keyPrefix: ['profile', 'rpc'],
  }).profile.read.queryOptions({ retry: false, staleTime: 60_000 })
}

function profileHttpOptions(client: HttpApiClient.ForApi<typeof profileApi>) {
  return createHttpApiQueryUtils(profileApi, {
    client,
    keyPrefix: ['profile', 'http'],
  }).profile.read.queryOptions({ retry: false, staleTime: 60_000 })
}

const snapshotProfile = (queryClient: QueryClient): string =>
  JSON.stringify(
    dehydrate(queryClient, {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query) =>
        defaultShouldDehydrateQuery(query) && query.queryKey[0] === 'profile',
      serializeData: Schema.encodeUnknownSync(Profile),
    }),
  )

const hydrateProfile = (queryClient: QueryClient, json: string): void =>
  hydrate(queryClient, JSON.parse(json), {
    defaultOptions: { deserializeData: Schema.decodeUnknownSync(Profile) },
  })
