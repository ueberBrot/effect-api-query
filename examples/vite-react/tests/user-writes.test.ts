import { User, UserPage } from '@effect-api-query/contracts'
import {
  InfiniteQueryObserver,
  MutationObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query'
import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { makeControlledUserWrites } from '../../../tests/fixtures/optimistic-users.ts'

const twoPageDirectory = (users: readonly User[]) => ({
  pages: [
    new UserPage({ users: users.slice(0, 4), total: users.length, nextCursor: 4 }),
    new UserPage({ users: users.slice(4), total: users.length, nextCursor: null }),
  ],
  pageParams: [0, 4],
})

describe('User writes in the Vite application', () => {
  it.each(
    (['rpc', 'http'] as const).flatMap((adapter) =>
      (['rpc', 'http'] as const).flatMap((refreshedAdapter) =>
        [false, true].map((retainOther) => ({ adapter, refreshedAdapter, retainOther })),
      ),
    ),
  )(
    'preserves an authoritative $refreshedAdapter list after a failed $adapter deletion with another user: $retainOther',
    async ({ adapter, refreshedAdapter, retainOther }) => {
      const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
      const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
      const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
      const alan = new User({ id: 2, name: 'Alan', locale: 'en' })
      const initial = retainOther ? [ada, alan] : [ada]
      fixture.seed(initial)
      const listKeys = {
        rpc: rpcQuery.users.list.queryKey(),
        http: httpQuery.users.list.queryKey(),
      }
      for (const key of Object.values(listKeys)) {
        queryClient.setQueryData(key, initial)
      }
      try {
        const deletion =
          adapter === 'rpc'
            ? new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 })
            : new MutationObserver(queryClient, userWrites.httpDelete()).mutate({
                params: { id: 1 },
              })
        const failure = Promise.allSettled([deletion])
        const request = await fixture.nextDelete()
        const optimistic = queryClient.getQueryData(listKeys[refreshedAdapter])
        const authoritative = retainOther ? [alan] : []
        fixture.seed(authoritative)
        await (refreshedAdapter === 'rpc'
          ? queryClient.query(rpcQuery.users.list.queryOptions())
          : queryClient.query(httpQuery.users.list.queryOptions()))
        expect(queryClient.getQueryData(listKeys[refreshedAdapter]) === optimistic).toBe(
          !retainOther || refreshedAdapter === 'rpc',
        )
        await request.fail()
        await expect(failure).resolves.toMatchObject([{ status: 'rejected' }])
        expect(queryClient.getQueryData(listKeys[refreshedAdapter])).toStrictEqual(authoritative)
        const otherAdapter = refreshedAdapter === 'rpc' ? 'http' : 'rpc'
        expect(queryClient.getQueryData(listKeys[otherAdapter])).toStrictEqual(initial)
      } finally {
        await fixture.application.dispose()
      }
    },
  )

  it.each(['rpc', 'http'] as const)(
    'keeps a refreshed %s list authoritative through a later creation and failed deletion',
    async (adapter) => {
      const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
      const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
      const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
      const grace = new User({ id: 2, name: 'Grace', locale: 'en' })
      const listKeys = {
        rpc: rpcQuery.users.list.queryKey(),
        http: httpQuery.users.list.queryKey(),
      }
      fixture.seed([ada])
      for (const key of Object.values(listKeys)) {
        queryClient.setQueryData(key, [ada])
      }
      try {
        const deletion = new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 })
        const failure = Promise.allSettled([deletion])
        const deleteRequest = await fixture.nextDelete()
        fixture.seed([])
        await (adapter === 'rpc'
          ? queryClient.query(rpcQuery.users.list.queryOptions())
          : queryClient.query(httpQuery.users.list.queryOptions()))
        const creation = new MutationObserver(queryClient, userWrites.httpCreate()).mutate({
          payload: { name: 'Grace' },
        })
        const createRequest = await fixture.nextCreate()
        await createRequest.succeed(grace)
        await creation
        await deleteRequest.fail()
        await expect(failure).resolves.toMatchObject([{ status: 'rejected' }])
        expect(queryClient.getQueryData(listKeys[adapter])).toStrictEqual([grace])
        const otherAdapter = adapter === 'rpc' ? 'http' : 'rpc'
        expect(queryClient.getQueryData(listKeys[otherAdapter])).toStrictEqual([ada, grace])
      } finally {
        await fixture.application.dispose()
      }
    },
  )

  it.each(['rpc', 'http'] as const)(
    'preserves a reentrant authoritative %s list publication during an optimistic edit',
    async (adapter) => {
      const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
      const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
      const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
      const alan = new User({ id: 2, name: 'Alan', locale: 'en' })
      const key =
        adapter === 'rpc' ? rpcQuery.users.list.queryKey() : httpQuery.users.list.queryKey()
      queryClient.setQueryData(key, [ada, alan])
      const { queryHash } = queryClient.defaultQueryOptions({ queryKey: key })
      let replace = true
      const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (
          replace &&
          event.query.queryHash === queryHash &&
          event.type === 'updated' &&
          event.action.type === 'success' &&
          event.action.manual === true
        ) {
          replace = false
          queryClient.setQueryData(key, [alan])
        }
      })
      try {
        const deletion = new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 })
        const failure = Promise.allSettled([deletion])
        const request = await fixture.nextDelete()
        await request.fail()
        await expect(failure).resolves.toMatchObject([{ status: 'rejected' }])
        expect(queryClient.getQueryData(key)).toStrictEqual([alan])
      } finally {
        unsubscribe()
        await fixture.application.dispose()
      }
    },
  )

  it.each(['rpc', 'http'] as const)(
    'keeps an authoritative %s list after both overlapping deletes fail',
    async (adapter) => {
      const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
      const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
      const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
      const key =
        adapter === 'rpc' ? rpcQuery.users.list.queryKey() : httpQuery.users.list.queryKey()
      fixture.seed([ada])
      queryClient.setQueryData(key, [ada])
      try {
        const older = new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 })
        const olderFailure = Promise.allSettled([older])
        const olderRequest = await fixture.nextDelete()
        const newer = new MutationObserver(queryClient, userWrites.httpDelete()).mutate({
          params: { id: 1 },
        })
        const newerFailure = Promise.allSettled([newer])
        const newerRequest = await fixture.nextDelete()
        fixture.seed([])
        await (adapter === 'rpc'
          ? queryClient.query(rpcQuery.users.list.queryOptions())
          : queryClient.query(httpQuery.users.list.queryOptions()))
        await olderRequest.fail()
        await olderFailure
        await newerRequest.fail()
        await expect(newerFailure).resolves.toMatchObject([{ status: 'rejected' }])
        expect(queryClient.getQueryData(key)).toStrictEqual([])
      } finally {
        await fixture.application.dispose()
      }
    },
  )

  it.each(['rpc', 'http'] as const)(
    'keeps equal authoritative %s pages independent of optimistic ownership',
    async (adapter) => {
      const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
      const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
      const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
      const key =
        adapter === 'rpc'
          ? rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 })
          : httpQuery.users.page.infiniteKey({ query: { cursor: 0, pageSize: 4 } })
      fixture.seed([ada])
      queryClient.setQueryData(key, {
        pages: [new UserPage({ users: [ada], total: 1, nextCursor: null })],
        pageParams: [0],
      })
      try {
        const deletion = new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 })
        const failure = Promise.allSettled([deletion])
        const request = await fixture.nextDelete()
        const optimisticPage = queryClient.getQueryData(key)?.pages[0]
        fixture.seed([])
        await (adapter === 'rpc'
          ? queryClient.infiniteQuery(
              rpcQuery.users.page.infiniteOptions({
                initialPageParam: 0,
                input: (cursor: number) => ({ cursor, pageSize: 4 }),
                getNextPageParam: (page) => page.nextCursor ?? undefined,
              }),
            )
          : queryClient.infiniteQuery(
              httpQuery.users.page.infiniteOptions({
                initialPageParam: 0,
                input: (cursor: number) => ({ query: { cursor, pageSize: 4 } }),
                getNextPageParam: (page) => page.nextCursor ?? undefined,
              }),
            ))
        const authoritativePage = queryClient.getQueryData(key)?.pages[0]
        expect(authoritativePage).toStrictEqual(optimisticPage)
        expect(authoritativePage).not.toBe(optimisticPage)
        await request.fail()
        await expect(failure).resolves.toMatchObject([{ status: 'rejected' }])
        expect(queryClient.getQueryData(key)?.pages[0]).toBe(authoritativePage)
      } finally {
        await fixture.application.dispose()
      }
    },
  )

  it.each(['rpc', 'http'] as const)(
    'preserves refreshed %s page totals when a pending creation fails',
    async (adapter) => {
      const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
      const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
      const rpcPages = rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 })
      const httpPages = httpQuery.users.page.infiniteKey({ query: { cursor: 0, pageSize: 4 } })
      for (const key of [rpcPages, httpPages]) {
        queryClient.setQueryData(key, {
          pages: [new UserPage({ users: [], total: 0, nextCursor: null })],
          pageParams: [0],
        })
      }
      try {
        const mutation =
          adapter === 'rpc'
            ? new MutationObserver(queryClient, userWrites.rpcCreate()).mutate({ name: 'Ada' })
            : new MutationObserver(queryClient, userWrites.httpCreate()).mutate({
                payload: { name: 'Ada' },
              })
        const failure = Promise.allSettled([mutation])
        const request = await fixture.nextCreate()
        await (adapter === 'rpc'
          ? queryClient.infiniteQuery(
              rpcQuery.users.page.infiniteOptions({
                initialPageParam: 0,
                input: (cursor: number) => ({ cursor, pageSize: 4 }),
                getNextPageParam: (page) => page.nextCursor ?? undefined,
              }),
            )
          : queryClient.infiniteQuery(
              httpQuery.users.page.infiniteOptions({
                initialPageParam: 0,
                input: (cursor: number) => ({ query: { cursor, pageSize: 4 } }),
                getNextPageParam: (page) => page.nextCursor ?? undefined,
              }),
            ))
        await request.fail()
        await expect(failure).resolves.toMatchObject([
          {
            status: 'rejected',
            reason: { name: adapter === 'rpc' ? 'EffectRpcQueryError' : 'EffectHttpApiQueryError' },
          },
        ])
        for (const key of [rpcPages, httpPages]) {
          expect(queryClient.getQueryData(key)).toStrictEqual({
            pages: [new UserPage({ users: [], total: 0, nextCursor: null })],
            pageParams: [0],
          })
        }
      } finally {
        await fixture.application.dispose()
      }
    },
  )

  it.each(['rpc', 'http'] as const)(
    'preserves refreshed %s page totals when a pending deletion fails',
    async (adapter) => {
      const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
      const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
      const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
      fixture.seed([ada])
      const rpcPages = rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 })
      const httpPages = httpQuery.users.page.infiniteKey({ query: { cursor: 0, pageSize: 4 } })
      for (const key of [rpcPages, httpPages]) {
        queryClient.setQueryData(key, {
          pages: [new UserPage({ users: [ada], total: 1, nextCursor: null })],
          pageParams: [0],
        })
      }
      try {
        const mutation =
          adapter === 'rpc'
            ? new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 })
            : new MutationObserver(queryClient, userWrites.httpDelete()).mutate({
                params: { id: 1 },
              })
        const failure = Promise.allSettled([mutation])
        const request = await fixture.nextDelete()
        await (adapter === 'rpc'
          ? queryClient.infiniteQuery(
              rpcQuery.users.page.infiniteOptions({
                initialPageParam: 0,
                input: (cursor: number) => ({ cursor, pageSize: 4 }),
                getNextPageParam: (page) => page.nextCursor ?? undefined,
              }),
            )
          : queryClient.infiniteQuery(
              httpQuery.users.page.infiniteOptions({
                initialPageParam: 0,
                input: (cursor: number) => ({ query: { cursor, pageSize: 4 } }),
                getNextPageParam: (page) => page.nextCursor ?? undefined,
              }),
            ))
        await request.fail()
        await expect(failure).resolves.toMatchObject([
          {
            status: 'rejected',
            reason: { name: adapter === 'rpc' ? 'EffectRpcQueryError' : 'EffectHttpApiQueryError' },
          },
        ])
        for (const key of [rpcPages, httpPages]) {
          expect(queryClient.getQueryData(key)).toStrictEqual({
            pages: [new UserPage({ users: [ada], total: 1, nextCursor: null })],
            pageParams: [0],
          })
        }
      } finally {
        await fixture.application.dispose()
      }
    },
  )

  it('restores an optimistic page without adjusting a freshly appended page', async () => {
    const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
    const { queryClient, rpcQuery, userWrites } = fixture.application
    const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
    const alan = new User({ id: 2, name: 'Alan', locale: 'en' })
    fixture.seed([ada, alan])
    const options = rpcQuery.users.page.infiniteOptions({
      initialPageParam: 0,
      input: (cursor: number) => ({ cursor, pageSize: 4 }),
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      staleTime: Infinity,
    })
    queryClient.setQueryData(options.queryKey, {
      pages: [new UserPage({ users: [ada], total: 2, nextCursor: 1 })],
      pageParams: [0],
    })
    let unsubscribe: (() => void) | undefined
    try {
      const deletion = new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 })
      const failure = Promise.allSettled([deletion])
      const request = await fixture.nextDelete()
      const observer = new InfiniteQueryObserver(queryClient, options)
      unsubscribe = observer.subscribe(() => {})
      await observer.fetchNextPage()
      unsubscribe()
      await request.fail()
      await expect(failure).resolves.toMatchObject([
        { status: 'rejected', reason: { name: 'EffectRpcQueryError' } },
      ])
      expect(queryClient.getQueryData(options.queryKey)).toStrictEqual({
        pages: [
          new UserPage({ users: [ada], total: 2, nextCursor: 1 }),
          new UserPage({ users: [alan], total: 2, nextCursor: null }),
        ],
        pageParams: [0, 1],
      })
    } finally {
      unsubscribe?.()
      await fixture.application.dispose()
    }
  })

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

  it.each(
    (['rpc', 'http'] as const).flatMap((adapter) =>
      [false, true].flatMap((addedTarget) =>
        [false, true].map((newerFailsFirst) => ({ adapter, addedTarget, newerFailsFirst })),
      ),
    ),
  )(
    'restores refreshed $adapter rows and pages through overlapping deletions; added target: $addedTarget, newer failure first: $newerFailsFirst',
    async ({ adapter, addedTarget, newerFailsFirst }) => {
      const fixture = await Effect.runPromise(makeControlledUserWrites(new QueryClient()))
      const { queryClient, rpcQuery, httpQuery, userWrites } = fixture.application
      const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
      const alan = new User({ id: 2, name: 'Alan', locale: 'en' })
      const grace = new User({ id: 3, name: 'Grace', locale: 'en' })
      const hopper = new User({ id: 4, name: 'Hopper', locale: 'en' })
      const knuth = new User({ id: 5, name: 'Knuth', locale: 'en' })
      const dennis = new User({ id: 6, name: 'Dennis', locale: 'en' })
      const initial = [ada, alan, grace, hopper, knuth, dennis]
      const updatedAlan = new User({ id: 2, name: 'Updated Alan', locale: 'fr' })
      const linus = new User({ id: 7, name: 'Linus', locale: 'fr' })
      const authoritative = [hopper, knuth, grace, dennis, updatedAlan, linus]
      const lists = {
        rpc: rpcQuery.users.list.queryKey(),
        http: httpQuery.users.list.queryKey(),
      }
      const pages = {
        rpc: rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 }),
        http: httpQuery.users.page.infiniteKey({ query: { cursor: 0, pageSize: 4 } }),
      }
      fixture.seed(initial)
      for (const key of Object.values(lists)) {
        queryClient.setQueryData(key, initial)
      }
      for (const key of Object.values(pages)) {
        queryClient.setQueryData(key, twoPageDirectory(initial))
      }
      const older = new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 1 })
      const olderOutcome = Promise.allSettled([older])
      const first = await fixture.nextDelete()
      try {
        fixture.seed(authoritative)
        await (adapter === 'rpc'
          ? queryClient.query(rpcQuery.users.list.queryOptions())
          : queryClient.query(httpQuery.users.list.queryOptions()))
        await (adapter === 'rpc'
          ? queryClient.infiniteQuery(
              rpcQuery.users.page.infiniteOptions({
                initialPageParam: 0,
                input: (cursor: number) => ({ cursor, pageSize: 4 }),
                getNextPageParam: (page) => page.nextCursor ?? undefined,
              }),
            )
          : queryClient.infiniteQuery(
              httpQuery.users.page.infiniteOptions({
                initialPageParam: 0,
                input: (cursor: number) => ({ query: { cursor, pageSize: 4 } }),
                getNextPageParam: (page) => page.nextCursor ?? undefined,
              }),
            ))
        const target = addedTarget ? linus : updatedAlan
        const newer =
          adapter === 'rpc'
            ? new MutationObserver(queryClient, userWrites.httpDelete()).mutate({
                params: { id: target.id },
              })
            : new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: target.id })
        const newerOutcome = Promise.allSettled([newer])
        const second = await fixture.nextDelete()
        const latest =
          adapter === 'rpc'
            ? new MutationObserver(queryClient, userWrites.rpcDelete()).mutate({ id: 3 })
            : new MutationObserver(queryClient, userWrites.httpDelete()).mutate({
                params: { id: 3 },
              })
        const latestOutcome = Promise.allSettled([latest])
        const third = await fixture.nextDelete()
        if (newerFailsFirst) {
          await second.fail()
          await newerOutcome
          await third.fail()
        } else {
          await third.fail()
          await latestOutcome
          await second.fail()
        }
        await expect(newerOutcome).resolves.toMatchObject([{ status: 'rejected' }])
        await expect(latestOutcome).resolves.toMatchObject([{ status: 'rejected' }])
        expect(queryClient.getQueryData(lists[adapter])).toStrictEqual(authoritative)
        expect(queryClient.getQueryData(pages[adapter])).toStrictEqual(
          twoPageDirectory(authoritative),
        )
        await first.fail()
        await olderOutcome
        const otherAdapter = adapter === 'rpc' ? 'http' : 'rpc'
        expect(queryClient.getQueryData(lists[adapter])).toStrictEqual(authoritative)
        expect(queryClient.getQueryData(pages[adapter])).toStrictEqual(
          twoPageDirectory(authoritative),
        )
        expect(queryClient.getQueryData(lists[otherAdapter])).toStrictEqual(initial)
        expect(queryClient.getQueryData(pages[otherAdapter])).toStrictEqual(
          twoPageDirectory(initial),
        )
      } finally {
        await first.fail()
        await olderOutcome
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
