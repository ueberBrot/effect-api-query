import { QueryClient } from '@tanstack/query-core'
import type { QueryFilters } from '@tanstack/query-core'
import type { EffectRpcQueryError } from 'effect-api-query'
import { HttpApiClient } from 'effect/http-api'
import { RpcClient, RpcGroup } from 'effect/rpc'

import { httpCacheFilters, usersApi } from './docs-cache-filters-http.ts'
import { userCacheFilters, usersRpc } from './docs-cache-filters-rpc.ts'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value

declare const rpcClient: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof usersRpc>>
declare const httpClient: HttpApiClient.ForApi<typeof usersApi>
declare const transportClient: RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof usersRpc>,
  { readonly _tag: 'TransportUnavailable' }
>
const queryClient = new QueryClient()
const rpcFilters = userCacheFilters(rpcClient)
const httpFilters = httpCacheFilters(httpClient)
const transportFilters = userCacheFilters(transportClient)
const transportState = queryClient.getQueryState(transportFilters.exact(1).queryKey)
transportState?.error satisfies
  | EffectRpcQueryError<{ readonly _tag: 'TransportUnavailable' }>
  | null
  | undefined

rpcFilters.root.queryKey satisfies readonly ['users-app', 'rpc']
rpcFilters.branch.queryKey satisfies readonly ['users-app', 'rpc', 'users']
rpcFilters.leaf.queryKey satisfies readonly ['users-app', 'rpc', 'users', 'get']
rpcFilters.query.queryKey satisfies readonly ['users-app', 'rpc', 'users', 'get', 'query']
rpcFilters.forId(1) satisfies QueryFilters
rpcFilters.historyForId(1) satisfies QueryFilters
rpcFilters.exact(1) satisfies QueryFilters
httpFilters.root.queryKey satisfies readonly ['users-app', 'http', 'users-api']
httpFilters.branch.queryKey satisfies readonly ['users-app', 'http', 'users-api', 'users']
httpFilters.query.queryKey satisfies readonly [
  'users-app',
  'http',
  'users-api',
  'users',
  'get',
  'query',
]
httpFilters.forId(1) satisfies QueryFilters
httpFilters.forLocale('en') satisfies QueryFilters
httpFilters.historyForId(1) satisfies QueryFilters

const exactUser = queryClient.getQueryData(rpcFilters.exact(1).queryKey)
true satisfies Assert<
  Equal<typeof exactUser, { readonly id: number; readonly name: string } | undefined>
>
queryClient.setQueryData(rpcFilters.exact(1).queryKey, { id: 1, name: 'Ada' })
// @ts-expect-error A concrete DataTag retains its query-data contract
queryClient.setQueryData(rpcFilters.exact(1).queryKey, 'Ada')
// @ts-expect-error Required constructor input cannot be omitted to build a partial filter
rpcFilters.rpc.users.get.queryKey({ locale: 'en' })

const partialUser = queryClient.getQueryData(rpcFilters.forId(1).queryKey)
true satisfies Assert<Equal<typeof partialUser, unknown>>
const matchingUsers = queryClient.getQueriesData(rpcFilters.forId(1))
true satisfies Assert<Equal<(typeof matchingUsers)[number][1], unknown>>
const history = queryClient.getQueryData(
  rpcFilters.rpc.users.watch.streamedKey({ id: 1 }, { maxChunks: 2, refetchMode: 'append' }),
)
true satisfies Assert<
  Equal<typeof history, readonly { readonly id: number; readonly name: string }[] | undefined>
>
const liveUser = queryClient.getQueryData(rpcFilters.rpc.users.watch.liveKey({ id: 1 }))
true satisfies Assert<
  Equal<typeof liveUser, { readonly id: number; readonly name: string } | undefined>
>

const input = {
  params: { id: 1 },
  query: { id: 7 },
  headers: { 'X-Locale': 'en' },
  payload: { id: 9 },
}
const exactHttp = httpFilters.exact(input)
exactHttp satisfies QueryFilters
const httpData = queryClient.getQueryData(exactHttp.queryKey)
true satisfies Assert<Equal<typeof httpData, string | undefined>>
queryClient.setQueryData(exactHttp.queryKey, 'Ada')
// @ts-expect-error HTTP concrete DataTags retain their own data representation
queryClient.setQueryData(exactHttp.queryKey, { id: 1, name: 'Ada' })
const partialHttp = queryClient.getQueryData(httpFilters.forId(1).queryKey)
true satisfies Assert<Equal<typeof partialHttp, unknown>>
const httpHistory = queryClient.getQueryData(
  httpFilters.http.users.watch.streamedKey({ query: { id: 1 } }, { maxChunks: 2 }),
)
true satisfies Assert<Equal<typeof httpHistory, readonly string[] | undefined>>
const httpLive = queryClient.getQueryData(
  httpFilters.http.users.watch.liveKey({ query: { id: 1 } }),
)
true satisfies Assert<Equal<typeof httpLive, string | undefined>>
const metadata = queryClient.getQueryData(httpFilters.http.users.get.metadataKey(input))
metadata?.data satisfies string | undefined
metadata?.status satisfies number | undefined
metadata?.headers satisfies Readonly<Record<string, string>> | undefined

queryClient.invalidateQueries({ ...rpcFilters.forId(1), type: 'inactive', stale: false })
queryClient.invalidateQueries(httpFilters.historyForId(1))
queryClient.invalidateQueries(exactHttp)
queryClient.setQueriesData(rpcFilters.query, (previous) => {
  true satisfies Assert<Equal<typeof previous, unknown>>
  return previous
})
