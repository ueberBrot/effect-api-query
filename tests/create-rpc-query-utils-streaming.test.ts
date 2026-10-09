import { describe, expect, it, vi } from '@effect/vitest'
import { QueryClient, QueryObserver, skipToken } from '@tanstack/query-core'
import { Cause, Deferred, Effect, Equal, Exit, Predicate, Schema, Stream } from 'effect'
import type { RpcClient } from 'effect/rpc'
import { Rpc, RpcGroup } from 'effect/rpc'
import { setTimeout } from 'node:timers/promises'

import {
  createRpcQueryUtils,
  EffectRpcQueryConfigError,
  EffectRpcQueryEmptyStreamError,
  EffectRpcQueryError,
  isEffectRpcQueryError,
} from '#effect-api-query'
import type { RunPromiseExit } from '#effect-api-query'

import { captureFailure } from './fixtures/async'
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

      const streamed = yield* Effect.promise(
        async () =>
          await queryClient.query(
            utils.events.watch.streamedOptions({ input: { channel: 'news' } }),
          ),
      )
      const live = yield* Effect.promise(
        async () =>
          await queryClient.query(utils.events.watch.liveOptions({ input: { channel: 'news' } })),
      )

      expect(streamed).toStrictEqual(['news:en:first', 'news:en:second'])
      expect(live).toBe('news:en:second')
      expect(utils.events.watch.streamedKey({ channel: 'news' })).toStrictEqual(
        utils.events.watch.streamedKey({ channel: 'news', locale: 'en' }),
      )
      expect(utils.events.watch.streamedKey({ channel: 'news' })).not.toStrictEqual(
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
        expect(yield* Effect.promise(async () => await queryClient.query(options))).toStrictEqual([
          3, 4,
        ])
        expect(snapshots.slice(0, 4)).toStrictEqual([[1], [1, 2], [2, 3], [3, 4]])
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
        let key: readonly unknown[] = []
        const client = yield* makeRpcTestClient(group, {
          'events.watch': () =>
            Stream.fromAsyncIterable(
              (async function* () {
                await Promise.resolve()
                expect(queryClient.getQueryData(key)).toStrictEqual(start)
                for (const value of [1, 2, 3]) {
                  yield value
                }
              })(),
              (cause) => cause,
            ).pipe(Stream.orDie),
        })
        const utils = createRpcQueryUtils(group, { client, keyPrefix: ['bounded'] })
        const options = utils.events.watch.streamedOptions({ maxChunks: 2, refetchMode })
        key = options.queryKey
        queryClient.setQueryData(options.queryKey, [-2, -1, 0, 9])
        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
          if (event.type === 'updated' && event.action.type === 'success') {
            snapshots.push(queryClient.getQueryData(options.queryKey))
          }
        })
        try {
          expect(yield* Effect.promise(async () => await queryClient.query(options))).toStrictEqual(
            [2, 3],
          )
          expect(snapshots).toStrictEqual(during)
          expect(queryClient.getQueryData(options.queryKey)).toStrictEqual([2, 3])
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
        expect(yield* Effect.promise(async () => await queryClient.query(options))).toStrictEqual(
          expected,
        )
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
        expect(yield* Effect.promise(async () => await queryClient.query(options))).toStrictEqual([
          9, 1,
        ])
        values = [2]
        expect(yield* Effect.promise(async () => await queryClient.query(options))).toStrictEqual([
          2,
        ])
        values = []
        expect(yield* Effect.promise(async () => await queryClient.query(options))).toStrictEqual(
          [],
        )
        expect(queryClient.getQueryData(options.queryKey)).toStrictEqual([])
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
      for (const maxChunks of [
        0,
        -1,
        1.5,
        Number.NaN,
        Infinity,
        -Infinity,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
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

      const error = yield* Effect.promise(
        async () =>
          await captureFailure(
            new QueryClient({ defaultOptions: { queries: { retry: false } } }).query(
              utils.events.empty.liveOptions(),
            ),
          ),
      )

      expect(error).toStrictEqual(
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

      const fetch = async (refetchMode: 'append' | 'replace' | 'reset') =>
        await queryClient.query(utils.events.watch.streamedOptions({ refetchMode }))

      expect(yield* Effect.promise(async () => await fetch('reset'))).toStrictEqual([
        'run-1-first',
        'run-1-second',
      ])
      expect(yield* Effect.promise(async () => await fetch('append'))).toStrictEqual([
        'run-2-first',
        'run-2-second',
      ])
      expect(yield* Effect.promise(async () => await fetch('append'))).toStrictEqual([
        'run-2-first',
        'run-2-second',
        'run-3-first',
        'run-3-second',
      ])
      expect(yield* Effect.promise(async () => await fetch('replace'))).toStrictEqual([
        'run-4-first',
        'run-4-second',
      ])
      expect(yield* Effect.promise(async () => await fetch('replace'))).toStrictEqual([
        'run-5-first',
        'run-5-second',
      ])
      expect(yield* Effect.promise(async () => await fetch('reset'))).toStrictEqual([
        'run-6-first',
        'run-6-second',
      ])
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
          fetch: async () => await queryClient.query(utils.events.declared.streamedOptions()),
          operation: 'streamed',
          tag: 'events.declared',
        },
        {
          direct: yield* Effect.exit(Stream.runCollect(client('events.stream-failure', undefined))),
          fetch: async () =>
            await queryClient.query(utils.events['stream-failure'].streamedOptions()),
          operation: 'streamed',
          tag: 'events.stream-failure',
        },
        {
          direct: yield* Effect.exit(Stream.runCollect(client('events.defect', undefined))),
          fetch: async () => await queryClient.query(utils.events.defect.liveOptions()),
          operation: 'live',
          tag: 'events.defect',
        },
      ] as const

      for (const { direct, fetch, operation, tag } of cases) {
        if (Exit.isSuccess(direct)) {
          throw new Error(`Expected ${tag} to fail`)
        }
        const error = yield* Effect.promise(async () => await captureFailure(fetch()))

        expect(error).toBeInstanceOf(EffectRpcQueryError)
        expect(error).toMatchObject({ operation, rpcTag: tag })
        if (!isEffectRpcQueryError(error)) {
          throw new Error('Expected RPC execution error')
        }
        expect(Equal.equals(error.cause, direct.cause)).toBe(true)
      }
    }),
  )

  it.effect.each(['live', 'streamed'] as const)(
    'preserves independent interruption and mixed Causes from an official client in %s queries',
    (operation) =>
      Effect.gen(function* () {
        const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
        const streamGroup = RpcGroup.make(Watch)
        const defect = new Error('stream defect')
        const causes = [
          Cause.interrupt(42),
          Cause.combine(Cause.interrupt(42), Cause.die(defect)),
        ] as const
        let [currentCause] = causes
        const client = yield* makeRpcTestClient(streamGroup, {
          'events.watch': () => Stream.failCause(currentCause),
        })
        const utils = createRpcQueryUtils(streamGroup, {
          client,
          keyPrefix: ['interrupt', operation],
        })
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        try {
          for (const cause of causes) {
            currentCause = cause
            const direct = yield* Effect.exit(Stream.runCollect(client('events.watch', undefined)))
            if (Exit.isSuccess(direct)) {
              throw new TypeError('Expected a failed client stream')
            }
            const error = yield* Effect.promise(
              async () =>
                await captureFailure(
                  operation === 'live'
                    ? queryClient.query(utils.events.watch.liveOptions())
                    : queryClient.query(utils.events.watch.streamedOptions()),
                ),
            )
            expect(error).toBeInstanceOf(EffectRpcQueryError)
            expect(error).toMatchObject({ rpcTag: 'events.watch', operation })
            if (!isEffectRpcQueryError(error)) {
              throw new TypeError('Expected an RPC execution error')
            }
            expect(error.cause).toStrictEqual(direct.cause)
          }
        } finally {
          queryClient.clear()
        }
      }),
  )

  it.effect('finalizes a stream after normal completion', () =>
    Effect.gen(function* () {
      const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
      const streamGroup = RpcGroup.make(Watch)
      const finalized = yield* Deferred.make<undefined>()
      const source = Stream.make('first', 'second').pipe(
        Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
      )
      // SAFETY: This one-RPC client fixture supplies the declared stream directly so finalization can be observed.
      /* oxlint-disable typescript/no-unsafe-type-assertion */
      const client = (() => source) as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof streamGroup>>
      /* oxlint-enable typescript/no-unsafe-type-assertion */
      const utils = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ['app'] as const,
      })

      const result = yield* Effect.promise(
        async () => await new QueryClient().query(utils.events.watch.streamedOptions()),
      )

      expect(result).toStrictEqual(['first', 'second'])
      yield* Deferred.await(finalized)
    }),
  )

  it('interrupts and finalizes a stream when Query Core cancels it', async () => {
    const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
    const streamGroup = RpcGroup.make(Watch)
    const waiting = Deferred.makeUnsafe<undefined>()
    const interrupted = Deferred.makeUnsafe<undefined>()
    const finalized = Deferred.makeUnsafe<undefined>()
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
    // SAFETY: This one-RPC client fixture supplies the declared stream directly so finalization can be observed.
    /* oxlint-disable typescript/no-unsafe-type-assertion */
    const client = (() => source) as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof streamGroup>>
    /* oxlint-enable typescript/no-unsafe-type-assertion */
    const queryClient = new QueryClient()
    const utils = createRpcQueryUtils(streamGroup, {
      client,
      keyPrefix: ['app'] as const,
    })
    const options = utils.events.watch.streamedOptions()

    const query = captureFailure(queryClient.query(options))
    await Effect.runPromise(Deferred.await(waiting))
    await queryClient.cancelQueries({ queryKey: options.queryKey })
    await setTimeout(10)

    expect(Deferred.isDoneUnsafe(interrupted)).toBe(true)
    expect(Deferred.isDoneUnsafe(finalized)).toBe(true)
    await expect(query).resolves.toStrictEqual(['ready'])
  })

  it('detaches the abort listener when iterator closure fails', async () => {
    const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
    const streamGroup = RpcGroup.make(Watch)
    const closeError = new Error('iterator closure failed')
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => await Promise.resolve({ done: false, value: 'ready' }),
        return: async () => await Promise.reject(closeError),
      }),
    }
    // SAFETY: The custom runner returns only this stream fixture so failed iterator closure can be observed.
    /* oxlint-disable typescript/no-unsafe-type-assertion */
    const runPromiseExit: RunPromiseExit = async () =>
      (await Promise.resolve(Exit.succeed(source))) as never
    /* oxlint-enable typescript/no-unsafe-type-assertion */
    // SAFETY: This one-RPC client fixture supplies the declared stream directly so finalization can be observed.
    /* oxlint-disable typescript/no-unsafe-type-assertion */
    const utils = createRpcQueryUtils(streamGroup, {
      client: (() => Stream.empty) as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof streamGroup>>,
      keyPrefix: ['app'] as const,
      runPromiseExit,
    })
    /* oxlint-enable typescript/no-unsafe-type-assertion */
    const options = utils.events.watch.streamedOptions()
    const { queryFn } = options
    if (!Predicate.isFunction(queryFn)) {
      throw new TypeError('Expected a callable stream query function')
    }
    const controller = new AbortController()
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener')
    controller.abort()

    await expect(
      queryFn({
        client: new QueryClient(),
        queryKey: options.queryKey,
        signal: controller.signal,
        meta: undefined,
      }),
    ).rejects.toBe(closeError)
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it.effect('finalizes the previous active stream before refetching', () =>
    Effect.gen(function* () {
      const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
      const streamGroup = RpcGroup.make(Watch)
      const firstStarted = yield* Deferred.make<undefined>()
      const firstFinalized = yield* Deferred.make<undefined>()
      const secondStarted = yield* Deferred.make<undefined>()
      const secondFinalized = yield* Deferred.make<undefined>()
      let run = 0
      // SAFETY: This one-RPC fixture creates the declared stream directly so successive finalization can be observed.
      /* oxlint-disable typescript/no-unsafe-type-assertion */
      const client = (() => {
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
      /* oxlint-enable typescript/no-unsafe-type-assertion */
      const queryClient = new QueryClient()
      const options = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ['app'] as const,
      }).events.watch.streamedOptions()

      const firstFetch = captureFailure(queryClient.query(options))
      yield* Deferred.await(firstStarted)
      const refetch = captureFailure(
        queryClient.refetchQueries({ exact: true, queryKey: options.queryKey }),
      )
      yield* Deferred.await(firstFinalized)
      yield* Deferred.await(secondStarted)
      yield* Effect.promise(async () => {
        await queryClient.cancelQueries({ queryKey: options.queryKey }).catch(() => {})
      })
      yield* Deferred.await(secondFinalized)

      yield* Effect.promise(async () => await firstFetch)
      expect(run).toBe(2)
      yield* Effect.promise(async () => await refetch)
    }),
  )

  it.effect('finalizes an active stream when its last observer unsubscribes', () =>
    Effect.gen(function* () {
      const Watch = Rpc.make('events.watch', { success: Schema.String, stream: true })
      const streamGroup = RpcGroup.make(Watch)
      const started = yield* Deferred.make<undefined>()
      const finalized = yield* Deferred.make<undefined>()
      const source = Stream.make('ready').pipe(
        Stream.concat(
          Stream.fromEffect(
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          ),
        ),
        Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
      )
      // SAFETY: This one-RPC client fixture supplies the declared stream directly so finalization can be observed.
      /* oxlint-disable typescript/no-unsafe-type-assertion */
      const client = (() => source) as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof streamGroup>>
      /* oxlint-enable typescript/no-unsafe-type-assertion */
      const queryClient = new QueryClient()
      const options = createRpcQueryUtils(streamGroup, {
        client,
        keyPrefix: ['app'] as const,
      }).events.watch.streamedOptions()
      const observer = new QueryObserver(queryClient, options)
      const unsubscribe = observer.subscribe(() => {})

      yield* Deferred.await(started)
      unsubscribe()
      yield* Deferred.await(finalized)
      expect(Deferred.isDoneUnsafe(finalized)).toBe(true)
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
          runPromiseExit: async (effect, options) => {
            executions += 1
            return await Effect.runPromiseExit(effect, options)
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
        const { options } = observer
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
        const unsubscribe = observer.subscribe(() => {})
        yield* Effect.promise(async () => {
          await queryClient.invalidateQueries({ queryKey: utils.events.key() })
        })
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
