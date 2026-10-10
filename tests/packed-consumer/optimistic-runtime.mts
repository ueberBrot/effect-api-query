import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core'
import { Effect, Exit } from 'effect'
import { deepStrictEqual, equal } from 'node:assert/strict'

import { User, UserPage } from '../../examples/contracts/src/contracts.ts'
import { makeControlledUserWrites } from '../fixtures/optimistic-users.ts'

const makeOwner = async () =>
  Effect.runPromise(
    makeControlledUserWrites(
      new QueryClient({
        defaultOptions: { queries: { queryKeyHashFn: (key) => `global:${JSON.stringify(key)}` } },
      }),
    ),
  )
const seed = (fixture: Awaited<ReturnType<typeof makeOwner>>, users: readonly User[]) => {
  const { queryClient, rpcQuery, httpQuery } = fixture.application
  fixture.seed(users)
  queryClient.setQueryDefaults(rpcQuery.users.key(), {
    queryKeyHashFn: (key) => `rpc:${JSON.stringify(key)}`,
  })
  queryClient.setQueryDefaults(httpQuery.users.key(), {
    queryKeyHashFn: (key) => `http:${JSON.stringify(key)}`,
  })
  queryClient.setQueryData(rpcQuery.users.list.queryKey(), users)
  queryClient.setQueryData(httpQuery.users.list.queryKey(), users)
}
const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
const alan = new User({ id: 2, name: 'Alan', locale: 'en' })
const grace = new User({ id: 3, name: 'Grace', locale: 'fr' })

{
  const fixture = await makeOwner()
  const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
  seed(fixture, [ada, alan])
  const rpcPages = rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 })
  const httpPages = httpQuery.users.page.infiniteKey({ query: { cursor: 0, pageSize: 4 } })
  const data = {
    pages: [
      new UserPage({ users: [ada], total: 2, nextCursor: 1 }),
      new UserPage({ users: [alan], total: 2, nextCursor: null }),
    ],
    pageParams: [0, 1],
  }
  queryClient.setQueryData(rpcPages, data)
  queryClient.setQueryData(httpPages, data)
  try {
    const deletion = Effect.runPromiseExit(
      Effect.promise(() =>
        new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 }),
      ),
    )
    const deleteRequest = await fixture.nextDelete()
    deepStrictEqual(queryClient.getQueryData(rpcQuery.users.list.queryKey()), [alan])
    deepStrictEqual(queryClient.getQueryData(httpPages)?.pages[0]?.users, [])
    const creation = new MutationObserver(queryClient, userWrites.httpCreate()).mutate({
      payload: { name: 'Grace', locale: 'fr' },
    })
    const createRequest = await fixture.nextCreate()
    deepStrictEqual(
      queryClient.getQueryData(httpQuery.users.list.queryKey())?.map((user) => user.name),
      ['Alan', 'Grace'],
    )
    await createRequest.succeed(grace)
    await creation
    deepStrictEqual(
      queryClient.getQueryData(rpcQuery.users.get.queryKey({ id: 3, locale: 'fr' })),
      grace,
    )
    deepStrictEqual(
      queryClient.getQueryData(
        httpQuery.users.get.queryKey({ params: { id: 3 }, query: { locale: 'fr' } }),
      ),
      grace,
    )
    await deleteRequest.fail()
    equal(Exit.isFailure(await deletion), true)
    deepStrictEqual(queryClient.getQueryData(rpcQuery.users.list.queryKey()), [ada, alan, grace])
    deepStrictEqual(queryClient.getQueryData(httpQuery.users.list.queryKey()), [ada, alan, grace])
    deepStrictEqual(queryClient.getQueryData(rpcPages), {
      pages: [
        new UserPage({ users: [ada], total: 3, nextCursor: 1 }),
        new UserPage({ users: [alan, grace], total: 3, nextCursor: null }),
      ],
      pageParams: [0, 1],
    })
    deepStrictEqual(queryClient.getQueryData(httpPages), queryClient.getQueryData(rpcPages))
    equal(queryClient.getQueryState(rpcQuery.users.list.queryKey())?.isInvalidated, true)
    equal(queryClient.getQueryState(httpQuery.users.list.queryKey())?.isInvalidated, true)
    equal(queryClient.getQueriesData({ queryKey: rpcQuery.users.list.key() }).length, 1)
    equal(queryClient.getQueriesData({ queryKey: httpQuery.users.list.key() }).length, 1)
  } finally {
    await fixture.application.dispose()
  }
}

for (const newerSucceeds of [true, false]) {
  const fixture = await makeOwner()
  const { queryClient, rpcQuery, userWrites } = fixture.application
  seed(fixture, [ada])
  try {
    const older = Effect.runPromiseExit(
      Effect.promise(() =>
        new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 }),
      ),
    )
    const first = await fixture.nextDelete()
    const newer = Effect.runPromiseExit(
      Effect.promise(() =>
        new MutationObserver(queryClient, userWrites.httpDelete()).mutate({ params: { id: 1 } }),
      ),
    )
    const second = await fixture.nextDelete()
    if (newerSucceeds) await second.succeed()
    else await second.fail()
    await newer
    await first.fail()
    equal(Exit.isFailure(await older), true)
    deepStrictEqual(
      queryClient.getQueryData(rpcQuery.users.list.queryKey()),
      newerSucceeds ? [] : [ada],
    )
  } finally {
    await fixture.application.dispose()
  }
}

{
  const fixture = await makeOwner()
  const { queryClient, rpcQuery, userWrites } = fixture.application
  seed(fixture, [])
  fixture.holdLists()
  const observer = new QueryObserver(
    queryClient,
    rpcQuery.users.list.queryOptions({ staleTime: Infinity }),
  )
  const unsubscribe = observer.subscribe(() => {})
  try {
    const older = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({ name: 'Ada' })
    const first = await fixture.nextCreate()
    await first.succeed(ada)
    const stale = await fixture.nextList()
    const newer = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({
      name: 'Grace',
      locale: 'fr',
    })
    const second = await fixture.nextCreate()
    await older
    await second.succeed(grace)
    const current = await fixture.nextList()
    await stale.succeed([ada])
    deepStrictEqual(queryClient.getQueryData(rpcQuery.users.list.queryKey()), [ada, grace])
    await current.succeed([ada, grace])
    await newer
    deepStrictEqual(queryClient.getQueryData(rpcQuery.users.list.queryKey()), [ada, grace])
    equal(queryClient.getQueriesData({ queryKey: rpcQuery.users.list.key() }).length, 1)
  } finally {
    unsubscribe()
    await fixture.application.dispose()
  }
}

{
  const fixture = await makeOwner()
  const { queryClient, rpcQuery, userWrites } = fixture.application
  seed(fixture, [])
  try {
    const older = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({ name: 'Ada' })
    const first = await fixture.nextCreate()
    const newer = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({
      name: 'Grace',
      locale: 'fr',
    })
    const second = await fixture.nextCreate()
    await second.succeed(grace)
    await newer
    await first.succeed(ada)
    await older
    deepStrictEqual(queryClient.getQueryData(rpcQuery.users.list.queryKey()), [ada, grace])
  } finally {
    await fixture.application.dispose()
  }
}

{
  const original = await makeOwner()
  const replacement = await makeOwner()
  const first = original.application
  const second = replacement.application
  seed(original, [])
  seed(replacement, [grace])
  try {
    const observer = new MutationObserver(first.queryClient, first.userWrites.rpcCreate())
    const mutation = observer.mutate({ name: 'Ada' })
    const request = await original.nextCreate()
    observer.setOptions(second.userWrites.rpcCreate())
    await request.succeed(ada)
    await mutation
    deepStrictEqual(first.queryClient.getQueryData(first.rpcQuery.users.list.queryKey()), [ada])
    deepStrictEqual(second.queryClient.getQueryData(second.rpcQuery.users.list.queryKey()), [grace])
    equal(
      second.queryClient.getQueryState(second.rpcQuery.users.list.queryKey())?.isInvalidated,
      false,
    )
    const pending = new MutationObserver(first.queryClient, first.userWrites.rpcCreate()).mutate({
      name: 'Alan',
    })
    const late = await original.nextCreate()
    original.retire()
    first.queryClient.clear()
    await late.succeed(alan)
    await pending
    equal(first.queryClient.getQueryCache().getAll().length, 0)
    deepStrictEqual(second.queryClient.getQueryData(second.rpcQuery.users.list.queryKey()), [grace])
  } finally {
    await original.application.dispose()
    await replacement.application.dispose()
  }
}

{
  const fixture = await makeOwner()
  const { queryClient, rpcQuery, userWrites } = fixture.application
  seed(fixture, [])
  const pages = rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 })
  queryClient.setQueryData(pages, {
    pages: [new UserPage({ users: [], total: 0, nextCursor: null })],
    pageParams: [0],
  })
  try {
    const older = Effect.runPromiseExit(
      Effect.promise(() =>
        new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({ name: 'Ada' }),
      ),
    )
    const first = await fixture.nextCreate()
    const newer = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({
      name: 'Grace',
      locale: 'fr',
    })
    const second = await fixture.nextCreate()
    await second.succeed(grace)
    await newer
    await first.fail()
    equal(Exit.isFailure(await older), true)
    deepStrictEqual(queryClient.getQueryData(rpcQuery.users.list.queryKey()), [grace])
    deepStrictEqual(queryClient.getQueryData(pages), {
      pages: [new UserPage({ users: [grace], total: 1, nextCursor: null })],
      pageParams: [0],
    })
  } finally {
    await fixture.application.dispose()
  }
}

console.log(
  'Packed copied optimistic user writes, pages, overlap, stale refetch and original ownership verified',
)
