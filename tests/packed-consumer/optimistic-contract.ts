import { QueryClient } from '@tanstack/query-core'
import type { InfiniteData } from '@tanstack/query-core'
import type { Effect } from 'effect'

import { User } from '../../examples/contracts/src/contracts.ts'
import type { UserPage } from '../../examples/contracts/src/contracts.ts'
import type { makeControlledUserWrites } from '../fixtures/optimistic-users.ts'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value

declare const fixture: Effect.Success<ReturnType<typeof makeControlledUserWrites>>
const { rpcQuery, httpQuery, userWrites } = fixture.application
const queryClient = new QueryClient()
const rpcUser = queryClient.getQueryData(rpcQuery.users.get.queryKey({ id: 1 }))
const httpUser = queryClient.getQueryData(
  httpQuery.users.get.queryKey({ params: { id: 1 }, query: {} }),
)
const rpcList = queryClient.getQueryData(rpcQuery.users.list.queryKey())
const rpcPages = queryClient.getQueryData(
  rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 }),
)
const httpPages = queryClient.getQueryData(
  httpQuery.users.page.infiniteKey({ query: { cursor: 0, pageSize: 4 } }),
)
true satisfies Assert<Equal<typeof rpcUser, User | undefined>>
true satisfies Assert<Equal<typeof httpUser, User | undefined>>
true satisfies Assert<Equal<typeof rpcList, readonly User[] | undefined>>
true satisfies Assert<Equal<typeof rpcPages, InfiniteData<UserPage> | undefined>>
true satisfies Assert<Equal<typeof httpPages, InfiniteData<UserPage> | undefined>>
const rpcCreate = userWrites.rpcCreate()
const httpCreate = userWrites.httpCreate()
const rpcDelete = userWrites.rpcDelete()
const httpDelete = userWrites.httpDelete()
true satisfies Assert<Equal<Awaited<ReturnType<typeof rpcCreate.mutationFn>>, User>>
true satisfies Assert<Equal<Awaited<ReturnType<typeof httpCreate.mutationFn>>, User>>
true satisfies Assert<Equal<Awaited<ReturnType<typeof rpcDelete.mutationFn>>, void>>
true satisfies Assert<Equal<Awaited<ReturnType<typeof httpDelete.mutationFn>>, void>>
queryClient.setQueryData(
  rpcQuery.users.get.queryKey({ id: 1 }),
  new User({ id: 1, name: 'Ada', locale: 'en' }),
)
queryClient.setQueryData(
  httpQuery.users.get.queryKey({ params: { id: 1 }, query: {} }),
  new User({ id: 1, name: 'Ada', locale: 'en' }),
)
