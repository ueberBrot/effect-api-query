import { QueryClient, QueryObserver, skipToken } from '@tanstack/query-core'
import type { QueryKey } from '@tanstack/query-core'
import { Deferred, Effect, Schema, Stream } from 'effect'
import { createRpcQueryUtils, EffectRpcQueryConfigError } from 'effect-api-query'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'
import { deepStrictEqual, equal, notDeepStrictEqual, ok, throws } from 'node:assert/strict'

const Watch = Rpc.make('events.watch', {
  payload: { channel: Schema.String },
  success: Schema.Number,
  stream: true,
})
const Audit = Rpc.make('events.audit.watch', { success: Schema.Number, stream: true })
const Other = Rpc.make('other.watch', { success: Schema.Number, stream: true })
const group = RpcGroup.make(Watch, Audit, Other)

const waitFor = async (queryClient: QueryClient, check: () => boolean) => {
  const ready = Deferred.makeUnsafe<undefined>()
  const observe = () => {
    if (check()) {
      Effect.runSync(Deferred.succeed(ready, undefined))
    }
  }
  const unsubscribe = queryClient.getQueryCache().subscribe(observe)
  try {
    observe()
    await Effect.runPromise(Deferred.await(ready).pipe(Effect.timeout('5 seconds')))
  } finally {
    unsubscribe()
  }
}

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
        Effect.provide(
          group.toLayer({
            'events.watch': () => Stream.make(1, 2, 3, 4),
            'events.audit.watch': () => Stream.make(1, 2, 3, 4),
            'other.watch': () => Stream.make(1, 2, 3, 4),
          }),
        ),
      )
      const utils = createRpcQueryUtils(group, { client, keyPrefix: ['stream-policy'] })
      const input = { channel: 'news' }
      deepStrictEqual(
        utils.events.watch.streamedKey(input),
        utils.events.watch.streamedKey(input, { maxChunks: undefined, refetchMode: 'reset' }),
      )
      deepStrictEqual(
        utils.events.watch.streamedOptions({ input }).queryKey,
        utils.events.watch.streamedOptions({ input, maxChunks: undefined, refetchMode: undefined })
          .queryKey,
      )
      deepStrictEqual(
        utils.events.audit.watch.streamedKey(),
        utils.events.audit.watch.streamedKey({ maxChunks: undefined, refetchMode: 'reset' }),
      )
      for (const refetchMode of ['reset', 'append', 'replace'] as const) {
        for (const maxChunks of [undefined, 2]) {
          const policy = { maxChunks, refetchMode }
          deepStrictEqual(
            utils.events.watch.streamedKey(input, policy),
            utils.events.watch.streamedOptions({ input, ...policy }).queryKey,
          )
          deepStrictEqual(
            utils.events.audit.watch.streamedKey(policy),
            utils.events.audit.watch.streamedOptions(policy).queryKey,
          )
        }
      }
      notDeepStrictEqual(
        utils.events.watch.streamedKey(input, { refetchMode: 'append' }),
        utils.events.watch.streamedKey(input, { refetchMode: 'replace' }),
      )
      const capturedPolicy = { maxChunks: 2, refetchMode: 'append' as const }
      const capturedKey = utils.events.watch.streamedKey(input, capturedPolicy)
      capturedPolicy.maxChunks = 4
      deepStrictEqual(
        capturedKey,
        utils.events.watch.streamedKey(input, { maxChunks: 2, refetchMode: 'append' }),
      )
      equal(Object.isFrozen(capturedKey), true)
      for (const order of [
        [4, 2],
        [2, 4],
      ]) {
        const queryClient = new QueryClient()
        try {
          for (const maxChunks of order) {
            const options = utils.events.watch.streamedOptions({
              input: { channel: 'news' },
              maxChunks,
              staleTime: Infinity,
            })
            const result = yield* Effect.promise(() => queryClient.query(options))
            deepStrictEqual(result, maxChunks === 2 ? [3, 4] : [1, 2, 3, 4])
          }
          equal(queryClient.getQueryCache().getAll().length, 2)
        } finally {
          queryClient.clear()
        }
      }

      const streamKeys: QueryKey[] = []
      for (const refetchMode of ['reset', 'append', 'replace'] as const) {
        for (const maxChunks of [undefined, 2]) {
          streamKeys.push(utils.events.watch.streamedKey(input, { maxChunks, refetchMode }))
        }
      }
      const keys = [
        ...streamKeys,
        utils.events.watch.liveKey(input),
        utils.events.audit.watch.streamedKey(),
        utils.other.watch.streamedKey(),
        ['unrelated'],
      ]
      const prefixes = [
        { key: utils.key(), count: 9 },
        { key: utils.events.key(), count: 8 },
        { key: utils.events.watch.key(), count: 7 },
        { key: [...utils.events.watch.key(), 'streamed'], count: 6 },
      ]
      for (const prefix of prefixes) {
        const queryClient = new QueryClient()
        try {
          for (const key of keys) {
            queryClient.setQueryData(key, [1])
          }
          equal(queryClient.getQueriesData({ queryKey: prefix.key }).length, prefix.count)
          yield* Effect.promise(() => queryClient.invalidateQueries({ queryKey: prefix.key }))
          deepStrictEqual(
            keys.map((key) => queryClient.getQueryState(key)?.isInvalidated),
            [
              ...Array.from({ length: prefix.count }, () => true),
              ...Array.from({ length: 10 - prefix.count }, () => false),
            ],
          )
        } finally {
          queryClient.clear()
        }
      }

      for (const [policy, code] of [
        ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null].map(
          (maxChunks) => [{ maxChunks }, 'InvalidMaxChunks'] as const,
        ),
        ...['unknown', null, 3].map(
          (refetchMode) => [{ refetchMode }, 'InvalidRefetchMode'] as const,
        ),
      ]) {
        const builders = [
          () => Reflect.apply(utils.events.watch.streamedKey, undefined, [input, policy]),
          () => Reflect.apply(utils.events.audit.watch.streamedKey, undefined, [policy]),
          ...[input, skipToken].map(
            (request) => () =>
              Reflect.apply(utils.events.watch.streamedOptions, undefined, [
                { input: request, ...policy },
              ]),
          ),
        ]
        for (const build of builders) {
          throws(build, (error: unknown) => {
            ok(error instanceof EffectRpcQueryConfigError)
            equal(error.code, code)
            return true
          })
        }
      }
    }),
  ),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const release = Deferred.makeUnsafe<undefined>()
      const client = yield* RpcTest.makeClient(RpcGroup.make(Watch), { flatten: true }).pipe(
        Effect.provide(
          RpcGroup.make(Watch).toLayer({
            'events.watch': () =>
              Stream.make(1, 2, 3, 4).pipe(
                Stream.concat(Stream.fromEffect(Deferred.await(release).pipe(Effect.as(5)))),
              ),
          }),
        ),
      )
      const utils = createRpcQueryUtils(RpcGroup.make(Watch), {
        client,
        keyPrefix: ['concurrent-stream-policy'],
      })
      const queryClient = new QueryClient()
      const narrow = utils.events.watch.streamedOptions({
        input: { channel: 'news' },
        maxChunks: 2,
      })
      const wide = utils.events.watch.streamedOptions({ input: { channel: 'news' }, maxChunks: 4 })
      const narrowObserver = new QueryObserver(queryClient, narrow)
      const wideObserver = new QueryObserver(queryClient, wide)
      const unsubscribeNarrow = narrowObserver.subscribe(() => undefined)
      const unsubscribeWide = wideObserver.subscribe(() => undefined)
      try {
        yield* Effect.promise(() =>
          waitFor(
            queryClient,
            () =>
              narrowObserver.getCurrentResult().data?.at(-1) === 4 &&
              wideObserver.getCurrentResult().data?.at(-1) === 4,
          ),
        )
        deepStrictEqual(narrowObserver.getCurrentResult().data, [3, 4])
        deepStrictEqual(wideObserver.getCurrentResult().data, [1, 2, 3, 4])
        equal(narrowObserver.getCurrentResult().fetchStatus, 'fetching')
        equal(wideObserver.getCurrentResult().fetchStatus, 'fetching')
        yield* Deferred.succeed(release, undefined)
        yield* Effect.promise(() =>
          waitFor(
            queryClient,
            () =>
              narrowObserver.getCurrentResult().fetchStatus === 'idle' &&
              wideObserver.getCurrentResult().fetchStatus === 'idle',
          ),
        )
        deepStrictEqual(narrowObserver.getCurrentResult().data, [4, 5])
        deepStrictEqual(wideObserver.getCurrentResult().data, [2, 3, 4, 5])
        equal(queryClient.getQueryCache().getAll().length, 2)
      } finally {
        unsubscribeNarrow()
        unsubscribeWide()
        queryClient.clear()
      }
    }),
  ),
)

for (const maxChunks of [undefined, 3]) {
  for (const refetchMode of ['reset', 'append', 'replace'] as const) {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let values = [1, 2]
          let release: Deferred.Deferred<undefined> | undefined
          const received = Deferred.makeUnsafe<undefined>()
          const watchGroup = RpcGroup.make(Watch)
          const client = yield* RpcTest.makeClient(watchGroup, { flatten: true }).pipe(
            Effect.provide(
              watchGroup.toLayer({
                'events.watch': () => {
                  const stream = Stream.fromIterable(values)
                  return release === undefined
                    ? stream
                    : stream.pipe(
                        Stream.concat(
                          Stream.fromEffect(
                            Deferred.succeed(received, undefined).pipe(
                              Effect.andThen(Deferred.await(release)),
                            ),
                          ).pipe(Stream.drain),
                        ),
                      )
                },
              }),
            ),
          )
          const utils = createRpcQueryUtils(watchGroup, { client, keyPrefix: ['refetch-policy'] })
          const queryClient = new QueryClient()
          const options = utils.events.watch.streamedOptions({
            input: { channel: 'news' },
            maxChunks,
            refetchMode,
          })
          try {
            deepStrictEqual(yield* Effect.promise(() => queryClient.query(options)), [1, 2])
            values = [3, 4]
            release = Deferred.makeUnsafe<undefined>()
            const pending = queryClient.refetchQueries({ queryKey: options.queryKey, exact: true })
            yield* Deferred.await(received).pipe(Effect.timeout('5 seconds'))
            const appended = maxChunks === 3 ? [2, 3, 4] : [1, 2, 3, 4]
            if (refetchMode !== 'replace') {
              yield* Effect.promise(() =>
                waitFor(
                  queryClient,
                  () => queryClient.getQueryData<readonly number[]>(options.queryKey)?.at(-1) === 4,
                ),
              )
            }
            deepStrictEqual(
              queryClient.getQueryData(options.queryKey),
              refetchMode === 'replace' ? [1, 2] : refetchMode === 'append' ? appended : [3, 4],
            )
            equal(queryClient.getQueryState(options.queryKey)?.fetchStatus, 'fetching')
            yield* Deferred.succeed(release, undefined)
            yield* Effect.promise(() => pending)
            deepStrictEqual(
              queryClient.getQueryData(options.queryKey),
              refetchMode === 'append' ? appended : [3, 4],
            )
            equal(queryClient.getQueryState(options.queryKey)?.fetchStatus, 'idle')
          } finally {
            queryClient.clear()
          }
        }),
      ),
    )
  }
}

console.log('Packed stream policy identity, concurrent histories, refetches, and prefixes verified')
