import { QueryClient, type InfiniteData } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createRpcQueryUtils, type RpcQueryUtils } from 'effect-api-query'
import { Rpc, RpcClient, RpcGroup } from 'effect/rpc'

// Reviewable baseline for TypeScript 7.0.2 with Query Core 5.102.2:
// 380 files, 169,060 types, and 220,313 instantiations. The packed-package task
// prints fresh extended diagnostics; timing and memory are intentionally not thresholds.
const indexes = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
] as const

const generatedRpcs = indexes.flatMap((index) => [
  Rpc.make(`scale.rpc-${index}` as const, {
    payload: { id: Schema.String },
    success: Schema.String,
  }),
  Rpc.make(`scale.group-${index}.get` as const, {
    payload: { id: Schema.String },
    success: Schema.String,
  }),
  Rpc.make(`scale.region-${index}.users.get` as const, {
    payload: { id: Schema.String },
    success: Schema.String,
  }),
  Rpc.make(`scale.zone-${index}.accounts.users.get` as const, {
    payload: { id: Schema.String },
    success: Schema.String,
  }),
  Rpc.make(`scale.cluster-${index}.organizations.accounts.users.get` as const, {
    payload: { id: Schema.String },
    success: Schema.String,
  }),
])

const group = RpcGroup.make(...generatedRpcs)
type Rpcs = RpcGroup.Rpcs<typeof group>

type Index = (typeof indexes)[number]
type ExpectedTag =
  | `scale.rpc-${Index}`
  | `scale.group-${Index}.get`
  | `scale.region-${Index}.users.get`
  | `scale.zone-${Index}.accounts.users.get`
  | `scale.cluster-${Index}.organizations.accounts.users.get`
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Condition extends true> = Condition

const allTagsPreserved: Assert<Equal<Rpcs['_tag'], ExpectedTag>> = true

declare const client: RpcClient.RpcClient.Flat<Rpcs>

const keyPrefix = ['type-scale'] as const
const utils = createRpcQueryUtils(group, { client, keyPrefix })
const typedUtils: RpcQueryUtils<typeof group, typeof keyPrefix> = utils

utils.scale['rpc-0'].queryOptions({ input: { id: 'rpc-0' } })
utils.scale['group-12'].get.mutationOptions()
utils.scale['region-24'].users.get.queryKey({ id: 'user-24' })
utils.scale['zone-36'].accounts.users.get.queryOptions({ input: { id: 'user-36' } })
utils.scale['cluster-49'].organizations.accounts.users.get.mutationOptions()
const pages = utils.scale['zone-36'].accounts.users.get.infiniteOptions({
  initialPageParam: 0,
  input: (page) => ({ id: `user-${page}` }),
  getNextPageParam: (_page, _pages, cursor) => cursor + 1,
})
const cachedPages = new QueryClient().getQueryData(pages.queryKey)
true satisfies Assert<Equal<typeof cachedPages, InfiniteData<string, number> | undefined>>

void [allTagsPreserved, typedUtils]
