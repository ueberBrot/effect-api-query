import { describe, expect, it } from '@effect/vitest'
import {
  MutationObserver,
  QueryClient,
  QueryObserver,
  skipToken as queryCoreSkipToken,
} from '@tanstack/query-core'
import { skipToken as reactQuerySkipToken } from '@tanstack/react-query'
import { Effect, Schema, Stream } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'

import { createRpcQueryUtils, skipToken } from '#effect-api-query'

import { group, makeClient, makeRpcTestClient } from './fixtures/effect-rpc'

describe('createRpcQueryUtils', () => {
  it.effect('preserves caller options while skipping a payload-bearing query', () =>
    Effect.gen(function* () {
      const client = yield* makeClient()
      let executions = 0
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
        runPromiseExit: (effect, options) => {
          executions += 1
          return Effect.runPromiseExit(effect, options)
        },
      })
      const supplied = Object.freeze({
        input: skipToken,
        initialData: { id: 1, locale: 'en', name: 'Ada' },
        select: (user: { name: string }) => user.name,
        staleTime: 30_000,
        gcTime: 0,
        meta: { source: 'conditional' },
        retry: false as const,
      })
      const options = utils.users.get.queryOptions(supplied)
      expect(options).toEqual({
        initialData: supplied.initialData,
        select: supplied.select,
        staleTime: 30_000,
        gcTime: 0,
        meta: supplied.meta,
        retry: false,
        queryFn: queryCoreSkipToken,
        queryKey: ['app', 'rpc', 'users', 'get', 'query'],
        queryKeyHashFn: utils.users.get.queryOptions(skipToken).queryKeyHashFn,
      })
      const queryClient = new QueryClient()
      const observer = new QueryObserver(queryClient, options)
      const unsubscribe = observer.subscribe(() => undefined)
      yield* Effect.promise(() => queryClient.invalidateQueries({ queryKey: utils.users.key() }))
      expect(observer.getCurrentResult()).toMatchObject({ data: 'Ada', fetchStatus: 'idle' })
      expect(executions).toBe(0)
      unsubscribe()
      queryClient.clear()
    }),
  )

  it.effect('creates frozen nested utilities and semantic keys', () =>
    Effect.gen(function* () {
      const client = yield* makeClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
      })

      expect(utils.key()).toEqual(['app', 'rpc'])
      expect(utils.users.key()).toEqual(['app', 'rpc', 'users'])
      expect(utils.users.get.key()).toEqual(['app', 'rpc', 'users', 'get'])
      expect(utils.users.get.mutationKey()).toEqual(['app', 'rpc', 'users', 'get', 'mutation'])
      expect(utils.users.get.queryKey({ id: 1 })).toEqual([
        'app',
        'rpc',
        'users',
        'get',
        'query',
        { id: 1, locale: 'en' },
      ])
      expect(utils.toString.child.key()).toEqual(['app', 'rpc', 'toString', 'child'])
      expect(utils.events.watch.key()).toEqual(['app', 'rpc', 'events', 'watch'])
      expect(utils.events.watch.streamedKey()).toEqual([
        'app',
        'rpc',
        'events',
        'watch',
        'streamed',
      ])
      expect(utils.events.watch.liveKey()).toEqual(['app', 'rpc', 'events', 'watch', 'live'])
      expect(Object.isFrozen(utils)).toBe(true)
      expect(Object.isFrozen(utils.users)).toBe(true)
      expect(Object.isFrozen(utils.users.get.queryKey({ id: 1 }))).toBe(true)
      expect(Object.isFrozen(utils.users.get.queryKey({ id: 1 }).at(-1))).toBe(true)
      const options = utils.users.get.queryOptions({ input: { id: 1 } })
      expect(options.queryKeyHashFn(options.queryKey)).toBe(JSON.stringify(options.queryKey))
    }),
  )

  it.effect('executes through Effect RPC and Query Core', () =>
    Effect.gen(function* () {
      const client = yield* makeClient()
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
      })

      const user = yield* Effect.promise(() =>
        queryClient.query(utils.users.get.queryOptions({ input: { id: 1 } })),
      )
      expect(user).toEqual({ id: 1, locale: 'en', name: 'Ada' })

      const getMutation = new MutationObserver(queryClient, utils.users.get.mutationOptions())
      const mutated = yield* Effect.promise(() => getMutation.mutate({ id: 2 }))
      expect(mutated).toEqual({ id: 2, locale: 'en', name: 'Ada' })
    }),
  )

  it.effect('normalizes undefined queries and preserves undefined mutations', () =>
    Effect.gen(function* () {
      const client = yield* makeClient()
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
      })

      const queryResult = yield* Effect.promise(() =>
        queryClient.query(utils.health.ping.queryOptions()),
      )
      expect(queryResult).toBeNull()

      const mutation = new MutationObserver(queryClient, utils.health.ping.mutationOptions())
      const mutationResult = yield* Effect.promise(() => mutation.mutate(undefined))
      expect(mutationResult).toBeUndefined()
    }),
  )

  it.effect('reuses Query Core skipToken', () =>
    Effect.gen(function* () {
      const client = yield* makeClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
      })

      expect(skipToken).toBe(queryCoreSkipToken)
      expect(skipToken).toBe(reactQuerySkipToken)
      const skipped = utils.users.get.queryOptions(skipToken)
      expect(skipped).toMatchObject({
        queryFn: queryCoreSkipToken,
        queryKey: ['app', 'rpc', 'users', 'get', 'query'],
      })
      expect(skipped.queryKeyHashFn(skipped.queryKey)).toBe(JSON.stringify(skipped.queryKey))

      const infiniteCallerOptions = {
        getNextPageParam: () => undefined,
        initialPageParam: 0,
        initialData: { pages: [{ id: 1, locale: 'en', name: 'Ada' }], pageParams: [0] },
        select: (data: { pages: ReadonlyArray<{ name: string }> }) => data.pages[0]?.name,
        staleTime: 30_000,
        meta: { source: 'conditional' },
      }
      const skippedInfinite = utils.users.get.infiniteOptions({
        ...infiniteCallerOptions,
        input: skipToken,
      })
      expect(skippedInfinite).toEqual({
        ...infiniteCallerOptions,
        queryFn: queryCoreSkipToken,
        queryKey: ['app', 'rpc', 'users', 'get', 'infinite'],
        queryKeyHashFn: skipped.queryKeyHashFn,
      })
      expect(skippedInfinite.queryKeyHashFn(skippedInfinite.queryKey)).toBe(
        JSON.stringify(skippedInfinite.queryKey),
      )
    }),
  )

  it.effect('projects ordinary reflected objects with only the documented leaf interface', () =>
    Effect.gen(function* () {
      const Status = Rpc.make('status', { success: Schema.Void })
      const BracketOnly = Rpc.make('billing-history.list all', { success: Schema.Void })
      const reflectedGroup = RpcGroup.make(Status, BracketOnly)
      const client = yield* makeRpcTestClient(reflectedGroup, {
        'billing-history.list all': () => Effect.void,
        status: () => Effect.void,
      })
      const utils = createRpcQueryUtils(reflectedGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      expect(Object.getPrototypeOf(utils)).toBe(Object.prototype)
      expect(Reflect.ownKeys(utils)).toEqual(['key', 'status', 'billing-history'])
      expect(Object.keys(utils['billing-history']['list all']).sort()).toEqual([
        'infiniteKey',
        'infiniteOptions',
        'key',
        'mutationKey',
        'mutationOptions',
        'queryKey',
        'queryOptions',
      ])
      expect(utils['billing-history']['list all'].key()).toEqual([
        'app',
        'rpc',
        'billing-history',
        'list all',
      ])
      expect(yield* Effect.promise(() => Promise.resolve(utils))).toBe(utils)
    }),
  )

  it.effect('freezes the owned tree without freezing fresh options or caller values', () =>
    Effect.gen(function* () {
      const client = yield* makeClient()
      const utils = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['app'] as const,
      })
      const queryMeta = { source: 'caller' }
      const infiniteMeta = { source: 'infinite-caller' }
      const mutationMeta = { source: 'caller' }

      const firstInfinite = utils.users.get.infiniteOptions({
        getNextPageParam: () => undefined,
        initialPageParam: 0,
        input: (id: number) => ({ id }),
        meta: infiniteMeta,
      })
      const secondInfinite = utils.users.get.infiniteOptions({
        getNextPageParam: () => undefined,
        initialPageParam: 0,
        input: (id: number) => ({ id }),
        meta: infiniteMeta,
      })
      const firstQuery = utils.users.get.queryOptions({ input: { id: 1 }, meta: queryMeta })
      const secondQuery = utils.users.get.queryOptions({ input: { id: 1 }, meta: queryMeta })
      const firstMutation = utils.users.get.mutationOptions({ meta: mutationMeta })
      const secondMutation = utils.users.get.mutationOptions({ meta: mutationMeta })

      expect(Object.isFrozen(utils)).toBe(true)
      expect(Object.isFrozen(utils.users)).toBe(true)
      expect(Object.isFrozen(utils.users.get)).toBe(true)
      expect(Object.isFrozen(firstInfinite)).toBe(false)
      expect(Object.isFrozen(firstQuery)).toBe(false)
      expect(Object.isFrozen(firstMutation)).toBe(false)
      expect(firstInfinite).not.toBe(secondInfinite)
      expect(firstQuery).not.toBe(secondQuery)
      expect(firstMutation).not.toBe(secondMutation)
      expect(firstInfinite.meta).toBe(infiniteMeta)
      expect(firstQuery.meta).toBe(queryMeta)
      expect(firstMutation.meta).toBe(mutationMeta)
      expect(Object.isFrozen(infiniteMeta)).toBe(false)
      expect(Object.isFrozen(queryMeta)).toBe(false)
      expect(Object.isFrozen(mutationMeta)).toBe(false)
    }),
  )

  it.effect('projects unary and streaming leaves through their distinct interfaces', () =>
    Effect.gen(function* () {
      const ListReports = Rpc.make('reports.list', { success: Schema.String })
      const ReportsStream = Rpc.make('reports.watch', { success: Schema.String, stream: true })
      const NestedStream = Rpc.make('events.audit.watch', {
        success: Schema.String,
        stream: true,
      })
      const RootStream = Rpc.make('updates.watch', { success: Schema.String, stream: true })
      const mixedGroup = RpcGroup.make(ListReports, ReportsStream, NestedStream, RootStream)
      const client = yield* makeRpcTestClient(mixedGroup, {
        'events.audit.watch': () => Stream.empty,
        'reports.list': () => Effect.succeed('report'),
        'reports.watch': () => Stream.empty,
        'updates.watch': () => Stream.empty,
      })

      const utils = createRpcQueryUtils(mixedGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      expect(Object.keys(utils).sort()).toEqual(['events', 'key', 'reports', 'updates'])
      expect(Object.keys(utils.reports).sort()).toEqual(['key', 'list', 'watch'])
      expect(utils.reports.list.key()).toEqual(['app', 'rpc', 'reports', 'list'])
      expect(Object.keys(utils.events.audit.watch).sort()).toEqual([
        'key',
        'liveKey',
        'liveOptions',
        'streamedKey',
        'streamedOptions',
      ])
      expect(utils.events.audit.watch.streamedKey()).toEqual([
        'app',
        'rpc',
        'events',
        'audit',
        'watch',
        'streamed',
      ])
      expect(utils.events.audit.watch.liveKey()).toEqual([
        'app',
        'rpc',
        'events',
        'audit',
        'watch',
        'live',
      ])
      expect(utils.events.audit.watch.streamedKey()).not.toEqual(utils.events.audit.watch.liveKey())
      expect(utils.updates.watch.streamedKey()).toEqual([
        'app',
        'rpc',
        'updates',
        'watch',
        'streamed',
      ])
    }),
  )
})
