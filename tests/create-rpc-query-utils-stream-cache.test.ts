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
      const client = yield* makeRpcTestClient(group, {
        read: () => Effect.succeed('server'),
        watch: () =>
          Stream.succeed(undefined).pipe(
            Stream.concat(Stream.never),
            Stream.ensuring(Deferred.succeed(finalized, undefined)),
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
      try {
        yield* waitForQueryState(
          queryClient,
          () => observer.getCurrentResult().status === 'success',
        )
        expect(observer.getCurrentResult()).toMatchObject({ data: null, fetchStatus: 'fetching' })
        expect(queryClient.getQueryData(rpc.watch.liveKey())).toBeNull()
        expect(
          yield* Effect.promise(async () => await queryClient.query(rpc.read.queryOptions())),
        ).toBe('server')
        queryClient.setQueryData(rpc.read.queryKey(), 'native')
        expect(
          yield* Effect.promise(async () => await queryClient.query(rpc.read.queryOptions())),
        ).toBe('native')
        expect(queryClient.getQueryCache().getAll()).toHaveLength(2)
        expect(
          queryClient
            .getQueryCache()
            .getAll()
            .every((query) => query.queryHash.startsWith(`${mode}:`)),
        ).toBe(true)
      } finally {
        unsubscribe()
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
