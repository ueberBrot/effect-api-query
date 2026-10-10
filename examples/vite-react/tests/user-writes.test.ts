import { User, UserPage } from '@effect-api-query/contracts'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { makeControlledUserWrites } from '../../../tests/fixtures/optimistic-users.ts'

describe('User writes in the Vite application', () => {
  it('publishes a pending user and seeds the returned user through exact generated keys', async () => {
    const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
    const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
    const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
    queryClient.setQueryData(rpcQuery.users.list.queryKey(), [ada])
    queryClient.setQueryData(httpQuery.users.list.queryKey(), [ada])
    try {
      const mutation = new MutationObserver(queryClient, userWrites.rpcCreate())
      const result = mutation.mutate({ name: 'Grace', locale: 'fr' })
      const request = await fixture.nextCreate()
      expect(
        queryClient.getQueryData(rpcQuery.users.list.queryKey())?.map((user) => user.name),
      ).toStrictEqual(['Ada', 'Grace'])
      const grace = new User({ id: 2, name: 'Grace', locale: 'fr' })
      await request.succeed(grace)
      await expect(result).resolves.toStrictEqual(grace)
      expect(
        queryClient.getQueryData(rpcQuery.users.get.queryKey({ id: 2, locale: 'fr' })),
      ).toStrictEqual(grace)
      expect(
        queryClient.getQueryData(
          httpQuery.users.get.queryKey({ params: { id: 2 }, query: { locale: 'fr' } }),
        ),
      ).toStrictEqual(grace)
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toStrictEqual([ada, grace])
    } finally {
      await fixture.application.dispose()
    }
  })

  it('rolls back a failed deletion without erasing a newer creation or changing page parameters', async () => {
    const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
    const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
    const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
    const alan = new User({ id: 2, name: 'Alan', locale: 'en' })
    const grace = new User({ id: 3, name: 'Grace', locale: 'fr' })
    const rpcPages = rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 })
    const httpPages = httpQuery.users.page.infiniteKey({ query: { cursor: 0, pageSize: 4 } })
    fixture.seed([ada, alan])
    for (const key of [rpcQuery.users.list.queryKey(), httpQuery.users.list.queryKey()]) {
      queryClient.setQueryData(key, [ada, alan])
    }
    for (const key of [rpcPages, httpPages]) {
      queryClient.setQueryData(key, {
        pages: [
          new UserPage({ users: [ada], total: 2, nextCursor: 1 }),
          new UserPage({ users: [alan], total: 2, nextCursor: null }),
        ],
        pageParams: [0, 1],
      })
    }
    try {
      const deletion = new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 })
      const failure = Effect.runPromiseExit(Effect.promise(async () => deletion))
      const deleteRequest = await fixture.nextDelete()
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toStrictEqual([alan])
      expect(queryClient.getQueryData(rpcPages)?.pages[0]?.users).toStrictEqual([])
      const creation = new MutationObserver(queryClient, userWrites.httpCreate()).mutate({
        payload: { name: 'Grace', locale: 'fr' },
      })
      const createRequest = await fixture.nextCreate()
      await createRequest.succeed(grace)
      await creation
      await deleteRequest.fail()
      await expect(failure).resolves.toHaveProperty('_tag', 'Failure')
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toStrictEqual([
        ada,
        alan,
        grace,
      ])
      expect(queryClient.getQueryData(httpQuery.users.list.queryKey())).toStrictEqual([
        ada,
        alan,
        grace,
      ])
      expect(queryClient.getQueryData(rpcPages)).toStrictEqual({
        pages: [
          new UserPage({ users: [ada], total: 3, nextCursor: 1 }),
          new UserPage({ users: [alan, grace], total: 3, nextCursor: null }),
        ],
        pageParams: [0, 1],
      })
      expect(queryClient.getQueryData(httpPages)).toStrictEqual(queryClient.getQueryData(rpcPages))
    } finally {
      await fixture.application.dispose()
    }
  })

  it('keeps a newer successful deletion when an older delete fails', async () => {
    const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
    const { queryClient, rpcQuery, userWrites } = fixture.application
    const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
    fixture.seed([ada])
    queryClient.setQueryData(rpcQuery.users.list.queryKey(), [ada])
    try {
      const older = Effect.runPromiseExit(
        Effect.promise(async () =>
          new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 }),
        ),
      )
      const olderRequest = await fixture.nextDelete()
      const newer = new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 })
      const newerRequest = await fixture.nextDelete()
      await newerRequest.succeed()
      await newer
      await olderRequest.fail()
      await expect(older).resolves.toHaveProperty('_tag', 'Failure')
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toStrictEqual([])
    } finally {
      await fixture.application.dispose()
    }
  })

  it('restores the original entity when both overlapping deletes fail', async () => {
    const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
    const { queryClient, rpcQuery, userWrites } = fixture.application
    const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
    queryClient.setQueryData(rpcQuery.users.list.queryKey(), [ada])
    try {
      const older = Effect.runPromiseExit(
        Effect.promise(async () =>
          new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 }),
        ),
      )
      const olderRequest = await fixture.nextDelete()
      const newer = Effect.runPromiseExit(
        Effect.promise(async () =>
          new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 }),
        ),
      )
      const newerRequest = await fixture.nextDelete()
      await olderRequest.fail()
      await older
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toStrictEqual([])
      await newerRequest.fail()
      await expect(newer).resolves.toHaveProperty('_tag', 'Failure')
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toStrictEqual([ada])
    } finally {
      await fixture.application.dispose()
    }
  })

  it.each([true, false])(
    'restores distinct failed deletions in directory order with the earlier failure first: %s',
    async (earlierFailsFirst) => {
      const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
      const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
      const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
      const alan = new User({ id: 2, name: 'Alan', locale: 'en' })
      const grace = new User({ id: 3, name: 'Grace', locale: 'en' })
      const lists = [rpcQuery.users.list.queryKey(), httpQuery.users.list.queryKey()]
      const pages = [
        rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 }),
        httpQuery.users.page.infiniteKey({ query: { cursor: 0, pageSize: 4 } }),
      ]
      for (const key of lists) {
        queryClient.setQueryData(key, [ada, alan])
      }
      for (const key of pages) {
        queryClient.setQueryData(key, {
          pages: [new UserPage({ users: [ada, alan], total: 2, nextCursor: null })],
          pageParams: [0],
        })
      }
      try {
        const older = Effect.runPromiseExit(
          Effect.promise(async () =>
            new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 }),
          ),
        )
        const first = await fixture.nextDelete()
        const newer = Effect.runPromiseExit(
          Effect.promise(async () =>
            new MutationObserver(queryClient, userWrites.httpDelete()).mutate({
              params: { id: 2 },
            }),
          ),
        )
        const second = await fixture.nextDelete()
        const creation = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({
          name: 'Grace',
        })
        const created = await fixture.nextCreate()
        await created.succeed(grace)
        await creation
        if (earlierFailsFirst) {
          await first.fail()
          await older
          await second.fail()
          await newer
        } else {
          await second.fail()
          await newer
          await first.fail()
          await older
        }
        for (const key of lists) {
          expect(queryClient.getQueryData(key)).toStrictEqual([ada, alan, grace])
        }
        for (const key of pages) {
          expect(queryClient.getQueryData(key)).toStrictEqual({
            pages: [new UserPage({ users: [ada, alan, grace], total: 3, nextCursor: null })],
            pageParams: [0],
          })
        }
      } finally {
        await fixture.application.dispose()
      }
    },
  )

  it('preserves a newer creation when an older create callback completes late', async () => {
    const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
    const { queryClient, rpcQuery, userWrites } = fixture.application
    queryClient.setQueryData(rpcQuery.users.list.queryKey(), [])
    try {
      const older = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({
        name: 'Ada',
      })
      const olderRequest = await fixture.nextCreate()
      const newer = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({
        name: 'Grace',
      })
      const newerRequest = await fixture.nextCreate()
      const grace = new User({ id: 2, name: 'Grace', locale: 'en' })
      await newerRequest.succeed(grace)
      await newer
      const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
      await olderRequest.succeed(ada)
      await older
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toStrictEqual([ada, grace])
    } finally {
      await fixture.application.dispose()
    }
  })

  it('cancels an older reconciliation fetch before publishing a newer write', async () => {
    const fixture = await Effect.runPromise(
      makeControlledUserWrites(
        new QueryClient({
          defaultOptions: { queries: { queryKeyHashFn: (key) => `owner:${JSON.stringify(key)}` } },
        }),
      ),
    )
    const { queryClient, rpcQuery, userWrites } = fixture.application
    queryClient.setQueryData(rpcQuery.users.list.queryKey(), [])
    fixture.holdLists()
    const observer = new QueryObserver(
      queryClient,
      rpcQuery.users.list.queryOptions({ staleTime: Infinity }),
    )
    const unsubscribe = observer.subscribe(() => {})
    try {
      const older = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({
        name: 'Ada',
      })
      const first = await fixture.nextCreate()
      const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
      await first.succeed(ada)
      const stale = await fixture.nextList()
      const newer = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({
        name: 'Grace',
      })
      const second = await fixture.nextCreate()
      await older
      const grace = new User({ id: 2, name: 'Grace', locale: 'en' })
      await second.succeed(grace)
      const current = await fixture.nextList()
      await stale.succeed([ada])
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toStrictEqual([ada, grace])
      await current.succeed([ada, grace])
      await newer
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toStrictEqual([ada, grace])
      expect(queryClient.getQueriesData({ queryKey: rpcQuery.users.list.key() })).toHaveLength(1)
      expect(queryClient.getQueryState(rpcQuery.users.list.queryKey())?.isInvalidated).toBe(false)
    } finally {
      unsubscribe()
      await fixture.application.dispose()
    }
  })

  it('keeps late callbacks bound to a retired owner and leaves a replacement client untouched', async () => {
    const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
    const { queryClient, rpcQuery, userWrites } = fixture.application
    queryClient.setQueryData(rpcQuery.users.list.queryKey(), [])
    const replacement = new QueryClient()
    const grace = new User({ id: 2, name: 'Grace', locale: 'en' })
    replacement.setQueryData(rpcQuery.users.list.queryKey(), [grace])
    try {
      const mutation = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({
        name: 'Ada',
      })
      const request = await fixture.nextCreate()
      fixture.retire()
      queryClient.clear()
      await request.succeed(new User({ id: 1, name: 'Ada', locale: 'en' }))
      await mutation
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(replacement.getQueryData(rpcQuery.users.list.queryKey())).toStrictEqual([grace])
      expect(replacement.getQueryState(rpcQuery.users.list.queryKey())?.isInvalidated).toBe(false)
    } finally {
      replacement.clear()
      await fixture.application.dispose()
    }
  })

  it('settles through its original owner after native observer callbacks are replaced', async () => {
    const original = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
    const replacement = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
    const first = original.application
    const second = replacement.application
    const grace = new User({ id: 2, name: 'Grace', locale: 'en' })
    first.queryClient.setQueryData(first.rpcQuery.users.list.queryKey(), [])
    second.queryClient.setQueryData(second.rpcQuery.users.list.queryKey(), [grace])
    try {
      const observer = new MutationObserver(first.queryClient, first.userWrites.rpcCreate())
      const mutation = observer.mutate({ name: 'Ada' })
      const request = await original.nextCreate()
      observer.setOptions(second.userWrites.rpcCreate())
      const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
      await request.succeed(ada)
      await mutation
      expect(first.queryClient.getQueryData(first.rpcQuery.users.list.queryKey())).toStrictEqual([
        ada,
      ])
      expect(second.queryClient.getQueryData(second.rpcQuery.users.list.queryKey())).toStrictEqual([
        grace,
      ])
      expect(
        second.queryClient.getQueryState(second.rpcQuery.users.list.queryKey())?.isInvalidated,
      ).toBe(false)
    } finally {
      await original.application.dispose()
      await replacement.application.dispose()
    }
  })

  it('removes a failed creation without erasing a newer response or corrupting page totals', async () => {
    const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
    const { queryClient, rpcQuery, userWrites } = fixture.application
    queryClient.setQueryData(rpcQuery.users.list.queryKey(), [])
    const pages = rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 })
    queryClient.setQueryData(pages, {
      pages: [new UserPage({ users: [], total: 0, nextCursor: null })],
      pageParams: [0],
    })
    try {
      const older = Effect.runPromiseExit(
        Effect.promise(async () =>
          new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({ name: 'Ada' }),
        ),
      )
      const first = await fixture.nextCreate()
      const newer = new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({
        name: 'Grace',
      })
      const second = await fixture.nextCreate()
      const grace = new User({ id: 2, name: 'Grace', locale: 'en' })
      await second.succeed(grace)
      await newer
      await first.fail()
      await expect(older).resolves.toHaveProperty('_tag', 'Failure')
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toStrictEqual([grace])
      expect(queryClient.getQueryData(pages)).toStrictEqual({
        pages: [new UserPage({ users: [grace], total: 1, nextCursor: null })],
        pageParams: [0],
      })
    } finally {
      await fixture.application.dispose()
    }
  })
})
