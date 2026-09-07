import { describe, expect, it, vi } from '@effect/vitest'
import { QueryClient, QueryObserver, skipToken } from '@tanstack/query-core'
import { Deferred, Effect, Equal, Exit, Schema, Stream } from 'effect'
import { Rpc, RpcClient, RpcGroup } from 'effect/unstable/rpc'

import {
  createRpcQueryUtils,
  EffectRpcQueryConfigError,
  EffectRpcQueryEmptyStreamError,
  EffectRpcQueryError,
  type RunPromiseExit,
} from '#effect-api-query'

import { makeRpcTestClient } from './fixtures/effect-rpc'

describe('createRpcQueryUtils streaming execution', () => {
  it.effect('accumulates stream elements and publishes the latest live value', () =>
    Effect.gen(function* () {
      const Watch = Rpc.make('events.watch', {
        payload: {
          channel: Schema.String,
          locale: Schema.String.pipe(
            Schema.optionalKey,
            Schema.withConstructorDefault(Effect.succeed('en')),
          ),
        },
        success: Schema.String,
        stream: true,
      })
      const streamGroup = RpcGroup.make(Watch)
      const client = yield* makeRpcTestClient(streamGroup, {
        'events.watch': ({
          channel,
          locale = 'en',
        }: {
          readonly channel: string
          readonly locale?: string
        }) => Stream.make(`${channel}:${locale}:first`, `${channel}:${locale}:second`),
      })
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      const streamed = yield* Effect.promise(() =>
        queryClient.query(utils.events.watch.streamedOptions({ input: { channel: 'news' } })),
      )
      const live = yield* Effect.promise(() =>
        queryClient.query(utils.events.watch.liveOptions({ input: { channel: 'news' } })),
      )

      expect(streamed).toEqual(['news:en:first', 'news:en:second'])
      expect(live).toBe('news:en:second')
      expect(utils.events.watch.streamedKey({ channel: 'news' })).toEqual(
        utils.events.watch.streamedKey({ channel: 'news', locale: 'en' }),
      )
      expect(utils.events.watch.streamedKey({ channel: 'news' })).not.toEqual(
        utils.events.watch.liveKey({ channel: 'news' }),
      )
      expect(Object.isFrozen(utils.events.watch.streamedKey({ channel: 'news' }))).toBe(true)
    }),
  )

  it.effect('retains only the newest accumulated values after each emission', () =>
    Effect.gen(function* () {
      const Watch = Rpc.make('events.watch', { success: Schema.Finite, stream: true })
      const group = RpcGroup.make(Watch)
      const client = yield* makeRpcTestClient(group, {
        'events.watch': () => Stream.make(1, 2, 3, 4),
      })
      const utils = createRpcQueryUtils(group, { client, keyPrefix: ['bounded'] })
      const queryClient = new QueryClient()
      const options = utils.events.watch.streamedOptions({ maxChunks: 2 })
      const snapshots: unknown[] = []
      const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success') {
          snapshots.push(queryClient.getQueryData(options.queryKey))
        }
      })
      try {
        expect(yield* Effect.promise(() => queryClient.query(options))).toEqual([3, 4])
        expect(snapshots.slice(0, 4)).toEqual([[1], [1, 2], [2, 3], [3, 4]])
        expect(options).not.toHaveProperty('maxChunks')
      } finally {
        unsubscribe()
        queryClient.clear()
      }
    }),
  )

  it.effect.each([
    { refetchMode: 'reset', during: [[1], [1, 2], [2, 3], [2, 3]], start: undefined },
    {
      refetchMode: 'append',
      during: [
        [9, 1],
        [1, 2],
        [2, 3],
        [2, 3],
      ],
      start: [-2, -1, 0, 9],
    },
    {
      refetchMode: 'replace',
      during: [
        [2, 3],
        [2, 3],
      ],
      start: [-2, -1, 0, 9],
    },
  ] as const)(
    'bounds $refetchMode refetches through QueryClient',
    ({ refetchMode, during, start }) =>
      Effect.gen(function* () {
        const Watch = Rpc.make('events.watch', { success: Schema.Finite, stream: true })
        const group = RpcGroup.make(Watch)
        const queryClient = new QueryClient()
        const snapshots: unknown[] = []
        const key = ['bounded', 'rpc', 'events', 'watch', 'streamed'] as const
        const client = yield* makeRpcTestClient(group, {
          'events.watch': () =>
            Stream.fromAsyncIterable(
              (async function* () {
                expect(queryClient.getQueryData(key)).toEqual(start)
                for (const value of [1, 2, 3]) {
                  yield value
                }
              })(),
              (cause) => cause,
            ).pipe(Stream.orDie),
        })
        const utils = createRpcQueryUtils(group, { client, keyPrefix: ['bounded'] })
        const options = utils.events.watch.streamedOptions({ maxChunks: 2, refetchMode })
        queryClient.setQueryData(options.queryKey, [-2, -1, 0, 9])
        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
          if (event.type === 'updated' && event.action.type === 'success') {
            snapshots.push(queryClient.getQueryData(options.queryKey))
          }
        })
        try {
          expect(yield* Effect.promise(() => queryClient.query(options))).toEqual([2, 3])
          expect(snapshots).toEqual(during)
          expect(queryClient.getQueryData(options.queryKey)).toEqual([2, 3])
        } finally {
          unsubscribe()
          queryClient.clear()
        }
      }),
  )

  it.effect.each([
    { maxChunks: 1, expected: [4] },
    { maxChunks: Number.MAX_SAFE_INTEGER, expected: [1, 2, 3, 4] },
  ])('accepts the boundary value $maxChunks', ({ maxChunks, expected }) =>
    Effect.gen(function* () {
      const Watch = Rpc.make('events.watch', { success: Schema.Finite, stream: true })
      const group = RpcGroup.make(Watch)
      const client = yield* makeRpcTestClient(group, {
        'events.watch': () => Stream.make(1, 2, 3, 4),
      })
      const utils = createRpcQueryUtils(group, { client, keyPrefix: ['bounded'] })
      const queryClient = new QueryClient()
      try {
        const options = utils.events.watch.streamedOptions({ maxChunks })
        expect(yield* Effect.promise(() => queryClient.query(options))).toEqual(expected)
      } finally {
        queryClient.clear()
      }
    }),
  )

  it.effect('resets bounded accumulation independently of initial data', () =>
    Effect.gen(function* () {
      let values = [1]
      const Watch = Rpc.make('events.watch', { success: Schema.Finite, stream: true })
      const group = RpcGroup.make(Watch)
      const client = yield* makeRpcTestClient(group, {
        'events.watch': () => Stream.fromIterable(values),
      })
      const utils = createRpcQueryUtils(group, { client, keyPrefix: ['bounded'] })
      const options = utils.events.watch.streamedOptions({ initialData: [9], maxChunks: 2 })
      const queryClient = new QueryClient()
      try {
        expect(yield* Effect.promise(() => queryClient.query(options))).toEqual([9, 1])
        values = [2]
        expect(yield* Effect.promise(() => queryClient.query(options))).toEqual([2])
        values = []
        expect(yield* Effect.promise(() => queryClient.query(options))).toEqual([])
        expect(queryClient.getQueryData(options.queryKey)).toEqual([])
      } finally {
        queryClient.clear()
      }
    }),
  )

  it.effect('rejects invalid bounds synchronously, including skipped queries', () =>
    Effect.gen(function* () {
      const Watch = Rpc.make('events.watch', {
        payload: { channel: Schema.String },
        success: Schema.Finite,
        stream: true,
      })
      const group = RpcGroup.make(Watch)
      const client = yield* makeRpcTestClient(group, { 'events.watch': () => Stream.make(1) })
      const utils = createRpcQueryUtils(group, { client, keyPrefix: ['bounded'] })
      for (const maxChunks of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        for (const input of [{ channel: 'news' }, skipToken] as const) {
          const buildOptions = () =>
            input === skipToken
              ? utils.events.watch.streamedOptions({ input, maxChunks })
              : utils.events.watch.streamedOptions({ input, maxChunks })
          expect(buildOptions).toThrow(EffectRpcQueryConfigError)
          expect(buildOptions).toThrow(
            expect.objectContaining({ code: 'InvalidMaxChunks', rpcTag: 'events.watch' }),
          )
        }
      }
      const skipped = utils.events.watch.streamedOptions({ input: skipToken, maxChunks: 1 })
      expect(skipped.queryFn).toBe(skipToken)
      expect(skipped).not.toHaveProperty('maxChunks')
      expect(() =>
        utils.events.watch.streamedOptions({
          input: { channel: 'news' },
          maxChunks: Number.MAX_SAFE_INTEGER,
        }),
      ).not.toThrow()
    }),
  )

  it.effect('fails an empty live stream with its documented package error', () =>
    Effect.gen(function* () {
      const Empty = Rpc.make('events.empty', { success: Schema.String, stream: true })
      const streamGroup = RpcGroup.make(Empty)
      const client = yield* makeRpcTestClient(streamGroup, {
        'events.empty': () => Stream.empty,
      })
      const utils = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      const error = yield* Effect.promise(() =>
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
          .query(utils.events.empty.liveOptions())
          .catch((cause: unknown) => cause),
      )

      expect(error).toEqual(
        expect.objectContaining({
          _tag: 'EffectRpcQueryEmptyStreamError',
          rpcTag: 'events.empty',
        }),
      )
      expect(error).toBeInstanceOf(EffectRpcQueryEmptyStreamError)
    }),
  )

  it.effect('supports reset, append, and replace refetch modes', () =>
    Effect.gen(function* () {
      let run = 0
      const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
      const streamGroup = RpcGroup.make(Watch)
      const client = yield* makeRpcTestClient(streamGroup, {
        'events.watch': () => {
          run += 1
          return Stream.make(`run-${String(run)}-first`, `run-${String(run)}-second`)
        },
      })
      const queryClient = new QueryClient()
      const utils = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      const fetch = (refetchMode: 'append' | 'replace' | 'reset') =>
        queryClient.query(utils.events.watch.streamedOptions({ refetchMode }))

      expect(yield* Effect.promise(() => fetch('reset'))).toEqual(['run-1-first', 'run-1-second'])
      expect(yield* Effect.promise(() => fetch('append'))).toEqual([
        'run-1-first',
        'run-1-second',
        'run-2-first',
        'run-2-second',
      ])
      expect(yield* Effect.promise(() => fetch('replace'))).toEqual(['run-3-first', 'run-3-second'])
      expect(yield* Effect.promise(() => fetch('reset'))).toEqual(['run-4-first', 'run-4-second'])
    }),
  )

  it.effect('preserves stream, RPC, and defect Causes', () =>
    Effect.gen(function* () {
      const Declared = Rpc.make('events.declared', {
        success: Schema.String,
        error: Schema.Literal('stream-failure'),
        stream: true,
      }).setError(Schema.Literal('rpc-failure'))
      const StreamFailure = Rpc.make('events.stream-failure', {
        success: Schema.String,
        error: Schema.Literal('stream-failure'),
        stream: true,
      })
      const Defect = Rpc.make('events.defect', { success: Schema.String, stream: true })
      const streamGroup = RpcGroup.make(Declared, StreamFailure, Defect)
      const defect = new Error('stream defect')
      const client = yield* makeRpcTestClient(streamGroup, {
        'events.declared': () => Stream.fail('rpc-failure' as const),
        'events.defect': () => Stream.die(defect),
        'events.stream-failure': () => Stream.fail('stream-failure' as const),
      })
      const utils = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ['app'] as const,
      })
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

      const cases = [
        {
          direct: yield* Effect.exit(Stream.runCollect(client('events.declared', undefined))),
          fetch: () => queryClient.query(utils.events.declared.streamedOptions()),
          operation: 'streamed',
          tag: 'events.declared',
        },
        {
          direct: yield* Effect.exit(Stream.runCollect(client('events.stream-failure', undefined))),
          fetch: () => queryClient.query(utils.events['stream-failure'].streamedOptions()),
          operation: 'streamed',
          tag: 'events.stream-failure',
        },
        {
          direct: yield* Effect.exit(Stream.runCollect(client('events.defect', undefined))),
          fetch: () => queryClient.query(utils.events.defect.liveOptions()),
          operation: 'live',
          tag: 'events.defect',
        },
      ] as const

      for (const { direct, fetch, operation, tag } of cases) {
        if (Exit.isSuccess(direct)) {
          throw new Error(`Expected ${tag} to fail`)
        }
        const error = yield* Effect.promise(() => fetch().catch((cause: unknown) => cause))

        expect(error).toBeInstanceOf(EffectRpcQueryError)
        expect(error).toMatchObject({ operation, rpcTag: tag })
        expect(Equal.equals((error as EffectRpcQueryError<unknown>).cause, direct.cause)).toBe(true)
      }
    }),
  )

  it.effect('finalizes a stream after normal completion', () =>
    Effect.gen(function* () {
      const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
      const streamGroup = RpcGroup.make(Watch)
      const finalized = yield* Deferred.make<void>()
      const source = Stream.make('first', 'second').pipe(
        Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
      )
      const client = ((_tag: string, _payload: unknown) => source) as RpcClient.RpcClient.Flat<
        RpcGroup.Rpcs<typeof streamGroup>
      >
      const utils = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      const result = yield* Effect.promise(() =>
        new QueryClient().query(utils.events.watch.streamedOptions()),
      )

      expect(result).toEqual(['first', 'second'])
      yield* Deferred.await(finalized)
    }),
  )

  it('interrupts and finalizes a stream when Query Core cancels it', async () => {
    const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
    const streamGroup = RpcGroup.make(Watch)
    const waiting = Deferred.makeUnsafe<void>()
    const interrupted = Deferred.makeUnsafe<void>()
    const finalized = Deferred.makeUnsafe<void>()
    const source = Stream.make('ready').pipe(
      Stream.concat(
        Stream.fromEffect(
          Deferred.succeed(waiting, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)),
          ),
        ),
      ),
      Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
    )
    const client = ((_tag: string, _payload: unknown) => source) as RpcClient.RpcClient.Flat<
      RpcGroup.Rpcs<typeof streamGroup>
    >
    const queryClient = new QueryClient()
    const utils = createRpcQueryUtils(streamGroup, {
      client,
      keyPrefix: ['app'] as const,
    })
    const options = utils.events.watch.streamedOptions()

    const query = queryClient.query(options).catch((cause: unknown) => cause)
    await Effect.runPromise(Deferred.await(waiting))
    await queryClient.cancelQueries({ queryKey: options.queryKey })
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 10))

    expect(Deferred.isDoneUnsafe(interrupted)).toBe(true)
    expect(Deferred.isDoneUnsafe(finalized)).toBe(true)
    expect(await query).toEqual(['ready'])
  })

  it('detaches the abort listener when iterator closure fails', async () => {
    const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
    const streamGroup = RpcGroup.make(Watch)
    const closeError = new Error('iterator closure failed')
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: false, value: 'ready' }),
        return: () => Promise.reject(closeError),
      }),
    }
    const runPromiseExit: RunPromiseExit = async () => Exit.succeed(source) as never
    const utils = createRpcQueryUtils(streamGroup, {
      client: ((_tag: string, _payload: unknown) => Stream.empty) as RpcClient.RpcClient.Flat<
        RpcGroup.Rpcs<typeof streamGroup>
      >,
      keyPrefix: ['app'] as const,
      runPromiseExit,
    })
    const options = utils.events.watch.streamedOptions()
    const queryFn = options.queryFn as (context: {
      readonly client: QueryClient
      readonly queryKey: typeof options.queryKey
      readonly signal: AbortSignal
    }) => Promise<unknown>
    const controller = new AbortController()
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener')
    controller.abort()

    await expect(
      queryFn({
        client: new QueryClient(),
        queryKey: options.queryKey,
        signal: controller.signal,
      }),
    ).rejects.toBe(closeError)
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it.effect('finalizes the previous active stream before refetching', () =>
    Effect.gen(function* () {
      const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
      const streamGroup = RpcGroup.make(Watch)
      const firstStarted = yield* Deferred.make<void>()
      const firstFinalized = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      const secondFinalized = yield* Deferred.make<void>()
      let run = 0
      const client = ((_tag: string, _payload: unknown) => {
        run += 1
        const started = run === 1 ? firstStarted : secondStarted
        const finalized = run === 1 ? firstFinalized : secondFinalized
        return Stream.make(`run-${String(run)}`).pipe(
          Stream.concat(
            Stream.fromEffect(
              Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
            ),
          ),
          Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
        )
      }) as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof streamGroup>>
      const queryClient = new QueryClient()
      const options = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ['app'] as const,
      }).events.watch.streamedOptions()

      const firstFetch = queryClient.query(options).catch((cause: unknown) => cause)
      yield* Deferred.await(firstStarted)
      const refetch = queryClient
        .refetchQueries({ exact: true, queryKey: options.queryKey })
        .catch((cause: unknown) => cause)
      yield* Deferred.await(firstFinalized)
      yield* Deferred.await(secondStarted)
      yield* Effect.promise(() =>
        queryClient.cancelQueries({ queryKey: options.queryKey }).catch(() => undefined),
      )
      yield* Deferred.await(secondFinalized)

      yield* Effect.promise(() => firstFetch)
      expect(run).toBe(2)
      yield* Effect.promise(() => refetch)
    }),
  )

  it.effect('finalizes an active stream when its last observer unsubscribes', () =>
    Effect.gen(function* () {
      const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
      const streamGroup = RpcGroup.make(Watch)
      const started = yield* Deferred.make<void>()
      const finalized = yield* Deferred.make<void>()
      const source = Stream.make('ready').pipe(
        Stream.concat(
          Stream.fromEffect(
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          ),
        ),
        Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
      )
      const client = ((_tag: string, _payload: unknown) => source) as RpcClient.RpcClient.Flat<
        RpcGroup.Rpcs<typeof streamGroup>
      >
      const queryClient = new QueryClient()
      const options = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ['app'] as const,
      }).events.watch.streamedOptions()
      const observer = new QueryObserver(queryClient, options)
      const unsubscribe = observer.subscribe(() => undefined)

      yield* Deferred.await(started)
      unsubscribe()
      yield* Deferred.await(finalized)
    }),
  )

  it.effect.each(['live', 'streamed'] as const)(
    'preserves options and skips execution for the %s object form',
    (operation) =>
      Effect.gen(function* () {
        const Watch = Rpc.make('events.watch', {
          payload: { channel: Schema.String },
          success: Schema.String,
          stream: true,
        })
        const streamGroup = RpcGroup.make(Watch)
        const client = yield* makeRpcTestClient(streamGroup, {
          'events.watch': () => Stream.empty,
        })
        let executions = 0
        const utils = createRpcQueryUtils(streamGroup, {
          client,
          keyPrefix: ['app'] as const,
          runPromiseExit: (effect, options) => {
            executions += 1
            return Effect.runPromiseExit(effect, options)
          },
        })
        const callerOptions = Object.freeze({
          staleTime: 30_000,
          gcTime: 0,
          meta: { source: 'conditional' },
        })
        const queryClient = new QueryClient()
        const observer =
          operation === 'live'
            ? new QueryObserver(
                queryClient,
                utils.events.watch.liveOptions({
                  ...callerOptions,
                  input: skipToken,
                  initialData: 'first',
                  select: (value) => value.length,
                }),
              )
            : new QueryObserver(
                queryClient,
                utils.events.watch.streamedOptions({
                  ...callerOptions,
                  input: skipToken,
                  refetchMode: 'append',
                  initialData: ['first'],
                  select: (values) => values.length,
                }),
              )
        const options = observer.options
        expect(options).toMatchObject({
          ...callerOptions,
          queryFn: skipToken,
          queryKey: ['app', 'rpc', 'events', 'watch', operation],
        })
        expect(options).not.toHaveProperty('input')
        expect(options).not.toHaveProperty('refetchMode')
        expect(options.queryKeyHashFn).toBe(
          utils.events.watch.liveOptions(skipToken).queryKeyHashFn,
        )
        const unsubscribe = observer.subscribe(() => undefined)
        yield* Effect.promise(() => queryClient.invalidateQueries({ queryKey: utils.events.key() }))
        expect(observer.getCurrentResult()).toMatchObject({
          data: operation === 'live' ? 5 : 1,
          fetchStatus: 'idle',
        })
        expect(executions).toBe(0)
        unsubscribe()
        queryClient.clear()
      }),
  )

  it.effect('reuses Query Core skipToken for payload-bearing streams', () =>
    Effect.gen(function* () {
      const Watch = Rpc.make('events.watch', {
        payload: { channel: Schema.String },
        success: Schema.String,
        stream: true,
      })
      const streamGroup = RpcGroup.make(Watch)
      const client = yield* makeRpcTestClient(streamGroup, {
        'events.watch': () => Stream.empty,
      })
      const utils = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      expect(utils.events.watch.streamedOptions(skipToken)).toMatchObject({
        queryFn: skipToken,
        queryKey: ['app', 'rpc', 'events', 'watch', 'streamed'],
      })
      expect(utils.events.watch.liveOptions(skipToken)).toMatchObject({
        queryFn: skipToken,
        queryKey: ['app', 'rpc', 'events', 'watch', 'live'],
      })
    }),
  )
})
