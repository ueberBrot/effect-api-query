import { it } from '@effect/vitest'
import { QueryClient, QueryObserver } from '@tanstack/query-core'
import { Deferred, Effect, Schema, Stream } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { expect } from 'vite-plus/test'

import { createRpcQueryUtils } from '#effect-api-query'

import { makeRpcTestClient } from './fixtures/effect-rpc.ts'
import { waitForQueryState } from './fixtures/query-cache.ts'

it.effect('normalizes live emissions while preserving accumulated undefined elements', () =>
  Effect.gen(function* () {
    const group = RpcGroup.make(
      Rpc.make('watch', {
        success: Schema.UndefinedOr(Schema.NullOr(Schema.String)),
        stream: true,
      }),
    )
    let values: readonly (string | null | undefined)[] = []
    const client = yield* makeRpcTestClient(group, { watch: () => Stream.fromIterable(values) })
    const rpc = createRpcQueryUtils(group, { client, keyPrefix: ['values'] })
    const queryClient = new QueryClient()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        queryClient.clear()
      }),
    )
    for (const emissions of [[null], [undefined], ['first', undefined]] as const) {
      values = emissions
      const recorded: unknown[] = []
      const options = rpc.watch.liveOptions()
      const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success') {
          recorded.push(event.query.state.data)
        }
      })
      try {
        expect(yield* Effect.promise(async () => await queryClient.query(options))).toBeNull()
        expect(queryClient.getQueryData(options.queryKey)).toBeNull()
        if (emissions.length === 2) {
          expect(recorded.slice(0, 2)).toStrictEqual(['first', null])
        }
      } finally {
        unsubscribe()
      }
      expect(
        yield* Effect.promise(async () => await queryClient.query(rpc.watch.streamedOptions())),
      ).toStrictEqual(emissions)
      queryClient.clear()
    }
  }),
)

it.effect.each(['global', 'prefix'] as const)(
  'uses %s hashing for native reads, writes, and an open stream first publication',
  (mode) =>
    Effect.gen(function* () {
      const group = RpcGroup.make(
        Rpc.make('read', { success: Schema.String }),
        Rpc.make('watch', { success: Schema.Undefined, stream: true }),
      )
      const finalized = yield* Deferred.make<undefined>()
      let closed = 0
      const client = yield* makeRpcTestClient(group, {
        read: () => Effect.succeed('server'),
        watch: () =>
          Stream.succeed(undefined).pipe(
            Stream.concat(Stream.never),
            Stream.ensuring(
              Effect.sync(() => {
                closed += 1
              }).pipe(
                Effect.flatMap(() =>
                  closed === 2 ? Deferred.succeed(finalized, undefined) : Effect.void,
                ),
              ),
            ),
          ),
      })
      const rpc = createRpcQueryUtils(group, { client, keyPrefix: ['hashing'] })
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            queryKeyHashFn: (key) => `global:${JSON.stringify(key)}`,
            retry: false,
            staleTime: Infinity,
          },
        },
      })
      if (mode === 'prefix') {
        queryClient.setQueryDefaults(rpc.key(), {
          queryKeyHashFn: (key) => `prefix:${JSON.stringify(key)}`,
        })
      }
      const options = rpc.watch.liveOptions()
      const observer = new QueryObserver(queryClient, options)
      const unsubscribe = observer.subscribe(() => {})
      const history = new QueryObserver(queryClient, rpc.watch.streamedOptions())
      const stopHistory = history.subscribe(() => {})
      try {
        yield* waitForQueryState(
          queryClient,
          () =>
            observer.getCurrentResult().status === 'success' &&
            history.getCurrentResult().status === 'success',
        )
        expect(observer.getCurrentResult()).toMatchObject({ data: null, fetchStatus: 'fetching' })
        expect(queryClient.getQueryData(rpc.watch.liveKey())).toBeNull()
        expect(history.getCurrentResult()).toMatchObject({
          data: [undefined],
          fetchStatus: 'fetching',
        })
        expect(queryClient.getQueryData(rpc.watch.streamedKey())).toStrictEqual([undefined])
        queryClient.setQueryData(rpc.watch.liveKey(), null)
        queryClient.setQueryData(rpc.watch.streamedKey(), [undefined, undefined])
        expect(queryClient.getQueryData(rpc.watch.streamedKey())).toStrictEqual([
          undefined,
          undefined,
        ])
        expect(
          yield* Effect.promise(async () => await queryClient.query(rpc.read.queryOptions())),
        ).toBe('server')
        queryClient.setQueryData(rpc.read.queryKey(), 'native')
        expect(
          yield* Effect.promise(async () => await queryClient.query(rpc.read.queryOptions())),
        ).toBe('native')
        const pages = rpc.read.infiniteOptions({
          initialPageParam: 0,
          getNextPageParam: () => {},
        })
        expect(
          yield* Effect.promise(async () => await queryClient.infiniteQuery(pages)),
        ).toStrictEqual({ pages: ['server'], pageParams: [0] })
        queryClient.setQueryData(rpc.read.infiniteKey(), {
          pages: ['native'],
          pageParams: [0],
        })
        expect(
          yield* Effect.promise(async () => await queryClient.infiniteQuery(pages)),
        ).toStrictEqual({ pages: ['native'], pageParams: [0] })
        expect(queryClient.getQueryCache().getAll()).toHaveLength(4)
        expect(
          queryClient
            .getQueryCache()
            .getAll()
            .every((query) => query.queryHash.startsWith(`${mode}:`)),
        ).toBe(true)
      } finally {
        unsubscribe()
        stopHistory()
        yield* Effect.promise(async () => {
          await queryClient.cancelQueries()
        })
        yield* Deferred.await(finalized)
        queryClient.clear()
      }
    }),
)

it.effect('keeps concurrent retention views independent through completion', () =>
  Effect.gen(function* () {
    const group = RpcGroup.make(Rpc.make('watch', { success: Schema.Int, stream: true }))
    const release = yield* Deferred.make<undefined>()
    const client = yield* makeRpcTestClient(group, {
      watch: () =>
        Stream.make(1, 2, 3, 4).pipe(
          Stream.concat(Stream.fromEffect(Deferred.await(release).pipe(Effect.as(5)))),
        ),
    })
    const rpc = createRpcQueryUtils(group, { client, keyPrefix: ['retention'] })
    const queryClient = new QueryClient()
    const narrow = new QueryObserver(queryClient, rpc.watch.streamedOptions({ maxChunks: 2 }))
    const wide = new QueryObserver(queryClient, rpc.watch.streamedOptions({ maxChunks: 4 }))
    const stopNarrow = narrow.subscribe(() => {})
    const stopWide = wide.subscribe(() => {})
    try {
      yield* waitForQueryState(
        queryClient,
        () =>
          narrow.getCurrentResult().data?.at(-1) === 4 &&
          wide.getCurrentResult().data?.at(-1) === 4,
      )
      expect(narrow.getCurrentResult().data).toStrictEqual([3, 4])
      expect(wide.getCurrentResult().data).toStrictEqual([1, 2, 3, 4])
      yield* Deferred.succeed(release, undefined)
      yield* waitForQueryState(
        queryClient,
        () =>
          narrow.getCurrentResult().fetchStatus === 'idle' &&
          wide.getCurrentResult().fetchStatus === 'idle',
      )
      expect(narrow.getCurrentResult().data).toStrictEqual([4, 5])
      expect(wide.getCurrentResult().data).toStrictEqual([2, 3, 4, 5])
      expect(queryClient.getQueryCache().getAll()).toHaveLength(2)
    } finally {
      stopNarrow()
      stopWide()
      queryClient.clear()
    }
  }),
)

it.effect.each([{ order: [4, 2] }, { order: [2, 4] }] as const)(
  'fetches retention views in order $order and invalidates exact versus broad policies',
  ({ order }) =>
    Effect.gen(function* () {
      const group = RpcGroup.make(Rpc.make('watch', { success: Schema.Int, stream: true }))
      let calls = 0
      const client = yield* makeRpcTestClient(group, {
        watch: () => {
          calls += 1
          return Stream.make(1, 2, 3, 4)
        },
      })
      const rpc = createRpcQueryUtils(group, { client, keyPrefix: ['retention-order'] })
      const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
      try {
        for (const maxChunks of order) {
          expect(
            yield* Effect.promise(
              async () => await queryClient.query(rpc.watch.streamedOptions({ maxChunks })),
            ),
          ).toStrictEqual(maxChunks === 2 ? [3, 4] : [1, 2, 3, 4])
        }
        const narrow = rpc.watch.streamedKey({ maxChunks: 2 })
        const wide = rpc.watch.streamedKey({ maxChunks: 4 })
        const append = rpc.watch.streamedOptions({ maxChunks: 2, refetchMode: 'append' })
        yield* Effect.promise(async () => await queryClient.query(append))
        yield* Effect.promise(async () => await queryClient.query(rpc.watch.liveOptions()))
        queryClient.setQueryData(['unrelated'], 42)
        yield* Effect.promise(async () => {
          await queryClient.invalidateQueries({
            queryKey: narrow,
            exact: true,
            refetchType: 'none',
          })
        })
        expect(queryClient.getQueryState(narrow)?.isInvalidated).toBe(true)
        expect(queryClient.getQueryState(wide)?.isInvalidated).toBe(false)
        expect(queryClient.getQueryState(append.queryKey)?.isInvalidated).toBe(false)
        queryClient.setQueryData(narrow, [3, 4])
        yield* Effect.promise(async () => {
          await queryClient.invalidateQueries({
            queryKey: [...rpc.watch.key(), 'streamed'],
            refetchType: 'none',
          })
        })
        for (const key of [narrow, wide, append.queryKey]) {
          expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
        }
        expect(queryClient.getQueryState(rpc.watch.liveKey())?.isInvalidated).toBe(false)
        yield* Effect.promise(async () => {
          await queryClient.invalidateQueries({ queryKey: rpc.watch.key(), refetchType: 'none' })
        })
        expect(queryClient.getQueryState(rpc.watch.liveKey())?.isInvalidated).toBe(true)
        expect(queryClient.getQueryState(['unrelated'])?.isInvalidated).toBe(false)
        expect(queryClient.getQueryData(narrow)).toStrictEqual([3, 4])
        expect(queryClient.getQueryData(wide)).toStrictEqual([1, 2, 3, 4])
        expect(queryClient.getQueryCache().getAll()).toHaveLength(5)
        expect(calls).toBe(4)
      } finally {
        queryClient.clear()
      }
    }),
)
