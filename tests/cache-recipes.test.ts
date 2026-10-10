import { User } from '@effect-api-query/contracts'
import { it } from '@effect/vitest'
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, Exit, Schema, Scope, Stream } from 'effect'
import { Reactivity } from 'effect/reactivity'
import { Rpc, RpcGroup } from 'effect/rpc'
import { describe, expect, it as test } from 'vite-plus/test'

import { createRpcQueryUtils } from '#effect-api-query'

import { makeRpcTestClient } from './fixtures/effect-rpc.ts'
import { makeControlledUserWrites } from './fixtures/optimistic-users.ts'
import { makeUserEventConsumer } from './fixtures/user-events.ts'
import { Profile } from './types/docs-hydration-rich.ts'
import {
  Cursor,
  HistoryElement,
  prepareViewHydration,
  prepareViewSnapshot,
  ProfilePage,
  SnapshotDecoding,
  SnapshotEncoding,
} from './types/docs-hydration-views.ts'

describe('cache recipes', () => {
  test('refreshes event cursors once and defers gaps until an overlapping write settles', async () => {
    const queryClient = new QueryClient()
    const fixture = await Effect.runPromise(makeControlledUserWrites(queryClient))
    const scope = Scope.makeUnsafe()
    const reactivity = Effect.runSync(Reactivity.make)
    const { application } = fixture
    const { rpcQuery, httpQuery } = application
    const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
    const key = rpcQuery.users.get.queryKey({ id: 1, locale: 'en' })
    const diagnostic = rpcQuery.diagnostics.status.queryKey()
    fixture.seed([ada])
    queryClient.setQueryData(key, ada)
    queryClient.setQueryData(diagnostic, { started: 0, interrupted: 0 })
    queryClient.setQueryData(rpcQuery.users.list.queryKey(), [ada])
    queryClient.setQueryData(httpQuery.users.list.queryKey(), [ada])
    let finish: (() => Promise<void>) | undefined
    try {
      const consumer = await Effect.runPromise(
        makeUserEventConsumer(application, reactivity).pipe(Scope.provide(scope)),
      )
      const event = {
        schema: 'users.v1',
        ownerKey: consumer.ownerKey,
        cursor: 1,
        kind: 'user.changed',
        id: 1,
        locale: 'en',
      } as const
      await expect(Effect.runPromise(consumer.deliver(event))).resolves.toBe(true)
      await consumer.flush()
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
      queryClient.setQueryData(key, ada)
      await expect(Effect.runPromise(consumer.deliver(event))).resolves.toBe(false)
      await consumer.flush()
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
      const mutation = new MutationObserver(queryClient, application.userWrites.rpcCreate()).mutate(
        {
          name: 'Grace',
        },
      )
      const creation = await fixture.nextCreate()
      finish = async () => {
        await creation.succeed(new User({ id: 2, name: 'Grace', locale: 'en' }))
        await mutation
      }
      await expect(Effect.runPromise(consumer.deliver({ ...event, cursor: 3 }))).resolves.toBe(true)
      await consumer.flush()
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
      await finish()
      await consumer.flush()
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(diagnostic)?.isInvalidated).toBe(false)
      expect(consumer.cursor()).toBe(3)
      await expect(Effect.runPromise(consumer.resume(false))).resolves.toBe(0)
      await consumer.flush()
      await Effect.runPromise(Scope.close(scope, Exit.void))
      queryClient.setQueryData(key, ada)
      reactivity.invalidateUnsafe([consumer.reactivityKeys.all])
      await consumer.flush()
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
      await expect(Effect.runPromise(consumer.deliver({ ...event, cursor: 4 }))).resolves.toBe(
        false,
      )
    } finally {
      await finish?.()
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await application.dispose()
    }
  })

  it.effect(
    'hydrates undefined history elements and rich infinite page parameters with paired codecs',
    () =>
      Effect.gen(function* () {
        const profile = new Profile({
          name: 'Ada',
          credits: 9_007_199_254_740_993n,
          avatar: new Uint8Array([0, 1, 255]),
        })
        const group = RpcGroup.make(
          Rpc.make('watch', { success: HistoryElement, stream: true }),
          Rpc.make('page', { payload: { offset: Schema.BigIntFromString }, success: ProfilePage }),
        )
        const client = yield* makeRpcTestClient(group, {
          watch: () => Stream.make(profile, undefined, null),
          page: () => Effect.succeed({ rows: [profile], next: null }),
        })
        const history = createRpcQueryUtils(group, {
          client,
          keyPrefix: ['hydration-views', 'history'],
        }).watch.streamedOptions()
        const infinite = createRpcQueryUtils(group, {
          client,
          keyPrefix: ['hydration-views', 'infinite'],
        }).page.infiniteOptions({
          initialPageParam: new Cursor({ offset: 0n }),
          input: (cursor) => ({ offset: cursor.offset }),
          getNextPageParam: () => {},
        })
        const server = new QueryClient()
        const browser = new QueryClient()
        try {
          yield* Effect.promise(async () => await server.query(history))
          yield* Effect.promise(async () => await server.infiniteQuery(infinite))
          const json = yield* prepareViewSnapshot(server).pipe(
            Effect.provideService(SnapshotEncoding, { beforeEncode: Effect.void }),
          )
          yield* prepareViewHydration(browser, json).pipe(
            Effect.provideService(SnapshotDecoding, { beforeDecode: Effect.void }),
          )
          const restored = browser.getQueryData(history.queryKey)
          expect(restored?.slice(1)).toStrictEqual([undefined, null])
          const first = restored?.[0]
          expect(first).toBeInstanceOf(Profile)
          if (!(first instanceof Profile)) {
            throw new TypeError('Expected a decoded Profile')
          }
          expect(first.summary()).toBe('Ada: 9007199254740993 credits')
          expect(first.avatar).toStrictEqual(new Uint8Array([0, 1, 255]))
          const page = browser.getQueryData(infinite.queryKey)
          expect(page?.pageParams[0]).toBeInstanceOf(Cursor)
          expect(page?.pageParams[0]?.isStart()).toBe(true)
          expect(page?.pages[0]?.rows[0]?.summary()).toBe('Ada: 9007199254740993 credits')
        } finally {
          server.clear()
          browser.clear()
        }
      }),
  )
})
