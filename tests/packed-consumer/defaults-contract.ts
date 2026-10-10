import { QueryObserver } from '@tanstack/query-core'
import type { Schema } from 'effect'
import type { EffectHttpApiQueryError, EffectRpcQueryError } from 'effect-api-query'
import type { HttpClientError } from 'effect/http'
import type { HttpApiClient } from 'effect/http-api'
import type { RpcClient, RpcClientError, RpcGroup } from 'effect/rpc'

import { createApplicationQueries, usersRpc } from './docs-defaults.ts'
import { createHttpApplicationQueries, usersApi } from './docs-http-defaults.ts'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
type User = { readonly id: number; readonly name: string }
type RetryLater = { readonly _tag: 'RetryLater' }

declare const rpcClient: RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof usersRpc>,
  RpcClientError.RpcClientError
>
declare const httpClient: HttpApiClient.ForApi<typeof usersApi>

const rpcSetup = createApplicationQueries(rpcClient)
const httpSetup = createHttpApplicationQueries(httpClient)
const rpcSelected = new QueryObserver(rpcSetup.queryClient, rpcSetup.user).getCurrentResult()
const httpObserved = new QueryObserver(httpSetup.queryClient, httpSetup.user).getCurrentResult()
const rpcFetched = rpcSetup.queryClient.query(rpcSetup.user)
const rpcRefreshed = rpcSetup.queryClient.query(rpcSetup.refreshUser)
const rpcCached = rpcSetup.queryClient.getQueryData(rpcSetup.user.queryKey)
const httpFetched = httpSetup.queryClient.query(httpSetup.user)
const httpCached = httpSetup.queryClient.getQueryData(httpSetup.user.queryKey)
const metadataFetched = httpSetup.queryClient.query(httpSetup.metadata)
const metadataCached = httpSetup.queryClient.getQueryData(httpSetup.metadata.queryKey)

type Metadata = {
  readonly data: User
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
}

type Contract = [
  Assert<Equal<typeof rpcSelected.data, string | undefined>>,
  Assert<
    Equal<
      typeof rpcSelected.error,
      EffectRpcQueryError<RetryLater | RpcClientError.RpcClientError> | null
    >
  >,
  Assert<Equal<typeof rpcFetched, Promise<string>>>,
  Assert<Equal<typeof rpcRefreshed, Promise<User>>>,
  Assert<Equal<typeof rpcCached, User | undefined>>,
  Assert<Equal<typeof httpObserved.data, User | undefined>>,
  Assert<Equal<typeof httpFetched, Promise<User>>>,
  Assert<Equal<typeof httpCached, User | undefined>>,
  Assert<Equal<typeof metadataFetched, Promise<Metadata>>>,
  Assert<Equal<typeof metadataCached, Metadata | undefined>>,
  Assert<Equal<Extract<'queryKeyHashFn' | 'queryHash', keyof typeof rpcSetup.user>, never>>,
  Assert<Equal<Extract<'queryKeyHashFn' | 'queryHash', keyof typeof httpSetup.user>, never>>,
  Assert<Equal<Extract<'queryKeyHashFn' | 'queryHash', keyof typeof httpSetup.metadata>, never>>,
]

rpcSetup.rpc.users.get.queryOptions({
  input: { id: 1 },
  retry: (_count, error) => {
    error satisfies EffectRpcQueryError<RetryLater | RpcClientError.RpcClientError>
    return false
  },
})
httpSetup.http.users.get.queryOptions({
  input: { params: { id: 1 } },
  retry: (_count, error) => {
    error satisfies EffectHttpApiQueryError<
      RetryLater | HttpClientError.HttpClientError | Schema.SchemaError
    >
    return false
  },
})
httpSetup.http.users.get.metadataOptions({
  input: { params: { id: 1 } },
  select: (snapshot) => snapshot.data.name,
  retry: (_count, error) => {
    error satisfies EffectHttpApiQueryError<
      RetryLater | HttpClientError.HttpClientError | Schema.SchemaError
    >
    return false
  },
})

rpcSetup.queryClient.setQueryData(rpcSetup.user.queryKey, { id: 1, name: 'Grace' })
httpSetup.queryClient.setQueryData(httpSetup.user.queryKey, { id: 1, name: 'Grace' })
httpSetup.queryClient.setQueryData(httpSetup.metadata.queryKey, {
  data: { id: 1, name: 'Grace' },
  status: 200,
  headers: { etag: '"v2"' },
})

// @ts-expect-error A selected string is not the cached RPC query data.
rpcSetup.queryClient.setQueryData(rpcSetup.user.queryKey, 'Grace')
// @ts-expect-error HTTP cache writes preserve the declared decoded data type.
httpSetup.queryClient.setQueryData(httpSetup.user.queryKey, { id: '1', name: 'Grace' })
// @ts-expect-error A metadata key requires the complete metadata view.
httpSetup.queryClient.setQueryData(httpSetup.metadata.queryKey, { id: 1, name: 'Grace' })
// @ts-expect-error Generated builders own query keys.
rpcSetup.rpc.users.get.queryOptions({ input: { id: 1 }, queryKey: ['replacement'] })
// @ts-expect-error Generated builders own execution functions.
httpSetup.http.users.get.queryOptions({
  input: { params: { id: 1 } },
  queryFn: async () => ({ id: 1, name: 'replacement' }),
})
// @ts-expect-error Hashing belongs to QueryClient defaults.
rpcSetup.rpc.users.get.queryOptions({ input: { id: 1 }, queryKeyHashFn: JSON.stringify })
// @ts-expect-error Hashing belongs to QueryClient defaults.
httpSetup.http.users.get.metadataOptions({ input: { params: { id: 1 } }, queryHash: 'replacement' })

declare const contract: Contract
contract satisfies [true, true, true, true, true, true, true, true, true, true, true, true, true]
