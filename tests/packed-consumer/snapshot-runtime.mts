import {
  dehydrate,
  hydrate,
  QueryClient,
  QueryObserver,
  isCancelledError,
  onlineManager,
  skipToken,
} from '@tanstack/query-core'
import { Deferred, Effect, Exit, Schema, Scope, Stream } from 'effect'
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  fetchStreamSnapshot,
  isEffectRpcQueryError,
} from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import { HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from 'effect/http-api'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'
import { deepStrictEqual, equal, ok, rejects } from 'node:assert/strict'
import { getEventListeners } from 'node:events'

import { captureUpdates, updates } from './docs-stream-snapshot.ts'

const group = RpcGroup.make(
  Rpc.make('watch', {
    payload: { channel: Schema.String },
    success: Schema.Int,
    error: Schema.String,
    stream: true,
  }),
)
const api = HttpApi.make('snapshot-http').add(
  HttpApiGroup.make('events').add(
    HttpApiEndpoint.get('watch', '/watch', {
      success: HttpApiSchema.StreamSse({ data: Schema.Int }),
    }),
  ),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(api, ['events']).pipe(
        Effect.provide(
          HttpApiBuilder.group(api, 'events', (handlers) =>
            handlers.handle('watch', () =>
              Effect.succeed(
                Stream.succeed(1).pipe(Stream.concat(Stream.fromEffect(Effect.never))),
              ),
            ),
          ),
        ),
      )
      const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['snapshot-http'] })
      const queryClient = new QueryClient()
      deepStrictEqual(
        yield* Effect.promise(() =>
          fetchStreamSnapshot(queryClient, utils.events.watch.streamedOptions({ retry: false })),
        ),
        [1],
      )
      equal(
        yield* Effect.promise(() =>
          fetchStreamSnapshot(queryClient, utils.events.watch.liveOptions({ retry: false })),
        ),
        1,
      )
      equal(queryClient.isFetching(), 0)
      equal(queryClient.getQueryCache().hasListeners(), false)
      queryClient.clear()
    }),
  ).pipe(Effect.provide(HttpServer.layerServices)),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      for (const view of ['streamed', 'live'] as const) {
        for (const path of [
          'success',
          'timeout',
          'abort',
          'external cancel',
          'failure',
          'empty',
          'complete',
        ] as const) {
          const entered = yield* Deferred.make<void>()
          const closing = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          let finalized = false
          const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
            Effect.provide(group.toLayer({ watch: () => Stream.succeed(1) })),
          )
          const source =
            path === 'failure'
              ? Stream.fail('unavailable')
              : path === 'empty'
                ? Stream.empty
                : path === 'complete'
                  ? Stream.make(1, 2)
                  : path === 'success'
                    ? Stream.succeed(1).pipe(Stream.concat(Stream.fromEffect(Effect.never)))
                    : Stream.fromEffect(
                        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
                      )
          const ready = ((...args: Parameters<typeof client>) =>
            client(args[0], args[1], { ...args[2], asQueue: false }).pipe(
              Stream.flatMap(() => source),
              Stream.ensuring(
                Deferred.succeed(closing, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(
                    Effect.sync(() => {
                      finalized = true
                    }),
                  ),
                ),
              ),
            )) as typeof client
          const options = createRpcQueryUtils(group, {
            client: ready,
            keyPrefix: ['snapshot', path],
          }).watch
          const queryClient = new QueryClient()
          const abort = new AbortController()
          const reason = new Error('page aborted')
          let settled = false
          const nativeOptions =
            view === 'streamed'
              ? options.streamedOptions({ input: { channel: 'owned' }, retry: false })
              : options.liveOptions({ input: { channel: 'owned' }, retry: false })
          const queryKey = nativeOptions.queryKey
          const snapshot =
            view === 'streamed'
              ? fetchStreamSnapshot(
                  queryClient,
                  options.streamedOptions({ input: { channel: 'owned' }, retry: false }),
                  { signal: abort.signal, timeoutMs: path === 'timeout' ? 10 : 1_000 },
                )
              : fetchStreamSnapshot(
                  queryClient,
                  options.liveOptions({ input: { channel: 'owned' }, retry: false }),
                  { signal: abort.signal, timeoutMs: path === 'timeout' ? 10 : 1_000 },
                )
          const outcome = snapshot.then(
            (data) => {
              settled = true
              return { status: 'success' as const, data }
            },
            (error: unknown) => {
              settled = true
              return { status: 'failure' as const, error }
            },
          )
          if (path === 'abort' || path === 'external cancel') {
            yield* Deferred.await(entered)
            if (path === 'abort') abort.abort(reason)
            else yield* Effect.promise(() => queryClient.cancelQueries({ exact: true, queryKey }))
          }
          yield* Deferred.await(closing)
          yield* Effect.sleep('1 millis')
          equal(settled, false)
          equal(finalized, false)
          yield* Deferred.succeed(release, undefined)
          const result = yield* Effect.promise(() => outcome)
          equal(finalized, true)
          equal(queryClient.getQueryCache().hasListeners(), false)
          equal(queryClient.isFetching(), 0)
          equal(getEventListeners(abort.signal, 'abort').length, 0)
          if (path === 'timeout') {
            equal(result.status, 'failure')
            if (result.status === 'failure') {
              ok(result.error instanceof DOMException)
              equal(result.error.name, 'TimeoutError')
            }
          } else if (path === 'abort') {
            equal(result.status, 'failure')
            if (result.status === 'failure') equal(result.error, reason)
          } else if (path === 'external cancel') {
            equal(result.status, 'failure')
            if (result.status === 'failure') ok(isCancelledError(result.error))
          } else if (path === 'failure' || (path === 'empty' && view === 'live')) {
            equal(result.status, 'failure')
            if (result.status === 'failure') {
              if (path === 'failure') ok(isEffectRpcQueryError(result.error))
              else
                ok(
                  result.error instanceof Error &&
                    result.error.name === 'EffectRpcQueryEmptyStreamError',
                )
            }
          } else {
            equal(result.status, 'success')
            if (result.status === 'success')
              deepStrictEqual(result.data, view === 'streamed' ? (path === 'empty' ? [] : [1]) : 1)
          }
          abort.abort(new Error('late abort'))
          equal(queryClient.getQueryCache().hasListeners(), false)
          queryClient.clear()
        }
      }
    }),
  ),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const acquiring = yield* Deferred.make<void>()
      const allow = yield* Deferred.make<void>()
      let acquisitionFinalized = false
      let reads = 0
      const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
        Effect.provide(
          group.toLayer({
            watch: () =>
              Stream.fromEffect(
                Effect.sync(() => {
                  reads += 1
                  return 1
                }),
              ),
          }),
        ),
      )
      const runPromiseExit: RunPromiseExit = (effect, options) =>
        Effect.runPromiseExit(
          Deferred.succeed(acquiring, undefined).pipe(
            Effect.andThen(Deferred.await(allow)),
            Effect.andThen(effect),
            Effect.ensuring(
              Effect.sync(() => {
                acquisitionFinalized = true
              }),
            ),
          ),
          options,
        )
      const options = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['acquisition'],
        runPromiseExit,
      }).watch.liveOptions({ input: { channel: 'owned' }, retry: false })
      const queryClient = new QueryClient()
      const before = AbortSignal.abort(new Error('already aborted'))
      yield* Effect.promise(() =>
        rejects(
          fetchStreamSnapshot(queryClient, options, { signal: before }),
          (error: unknown) => error === before.reason,
        ),
      )
      equal(queryClient.getQueryCache().getAll().length, 0)
      const abort = new AbortController()
      const reason = new Error('abort acquisition')
      const outcome = rejects(
        fetchStreamSnapshot(queryClient, options, { signal: abort.signal }),
        (error: unknown) => error === reason,
      )
      yield* Deferred.await(acquiring)
      abort.abort(reason)
      yield* Effect.promise(() => outcome)
      equal(acquisitionFinalized, true)
      equal(reads, 0)
      equal(getEventListeners(abort.signal, 'abort').length, 0)
      equal(queryClient.getQueryCache().hasListeners(), false)
      queryClient.clear()
    }),
  ),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      let ownedClosed = false
      let otherClosed = false
      const started = yield* Deferred.make<void>()
      const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
        Effect.provide(
          group.toLayer({
            watch: ({ channel }) =>
              Stream.succeed(channel === 'owned' ? 1 : 2).pipe(
                Stream.concat(Stream.fromEffect(Effect.never)),
              ),
          }),
        ),
      )
      const ready = ((...args: Parameters<typeof client>) =>
        client(args[0], args[1], { ...args[2], asQueue: false }).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              if (args[1].channel === 'owned') ownedClosed = true
              else otherClosed = true
            }),
          ),
        )) as typeof client
      const utils = createRpcQueryUtils(group, { client: ready, keyPrefix: ['exact'] })
      const queryClient = new QueryClient()
      const other = utils.watch.liveOptions({ input: { channel: 'other' }, retry: false })
      const stop = queryClient.getQueryCache().subscribe(() => {
        if (queryClient.getQueryData(other.queryKey) === 2)
          Effect.runFork(Deferred.succeed(started, undefined))
      })
      const fetching = queryClient.query(other)
      yield* Deferred.await(started)
      stop()
      const owned = utils.watch.liveOptions({ input: { channel: 'owned' }, retry: false })
      equal(yield* Effect.promise(() => fetchStreamSnapshot(queryClient, owned)), 1)
      equal(ownedClosed, true)
      equal(otherClosed, false)
      equal(queryClient.getQueryState(other.queryKey)?.fetchStatus, 'fetching')
      equal(queryClient.getQueryData(other.queryKey), 2)
      yield* Effect.promise(() =>
        queryClient.cancelQueries({ exact: true, queryKey: other.queryKey }),
      )
      yield* Effect.promise(() => fetching)
      equal(queryClient.getQueryCache().hasListeners(), false)
      queryClient.clear()
    }),
  ),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      for (const view of ['streamed', 'live'] as const) {
        const serverScope = yield* Scope.make()
        let serverClosed = false
        let browserClosed = false
        let browserReads = 0
        const server = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
          Effect.provide(
            group.toLayer({
              watch: () => Stream.succeed(1).pipe(Stream.concat(Stream.fromEffect(Effect.never))),
            }),
          ),
          Effect.provideService(Scope.Scope, serverScope),
        )
        const browser = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
          Effect.provide(
            group.toLayer({
              watch: () =>
                Stream.fromEffect(
                  Effect.sync(() => {
                    browserReads += 1
                    return 2
                  }),
                ).pipe(Stream.concat(Stream.fromEffect(Effect.never))),
            }),
          ),
        )
        const serverReady = ((...args: Parameters<typeof server>) =>
          server(args[0], args[1], { ...args[2], asQueue: false }).pipe(
            Stream.ensuring(
              Effect.sync(() => {
                serverClosed = true
              }),
            ),
          )) as typeof server
        const browserReady = ((...args: Parameters<typeof browser>) =>
          browser(args[0], args[1], { ...args[2], asQueue: false }).pipe(
            Stream.ensuring(
              Effect.sync(() => {
                browserClosed = true
              }),
            ),
          )) as typeof browser
        const serverUtils = createRpcQueryUtils(group, {
          client: serverReady,
          keyPrefix: ['hydrate'],
        })
        const browserUtils = createRpcQueryUtils(group, {
          client: browserReady,
          keyPrefix: ['hydrate'],
        })
        const input = { channel: 'owned' }
        const serverOptions = serverUtils.watch.streamedOptions({ input, retry: false })
        const serverLive = serverUtils.watch.liveOptions({ input, retry: false })
        const browserOptions = browserUtils.watch.streamedOptions({ input, retry: false })
        const browserLive = browserUtils.watch.liveOptions({ input, retry: false })
        const serverQueryClient = new QueryClient()
        const browserQueryClient = new QueryClient()
        deepStrictEqual(
          view === 'streamed'
            ? yield* Effect.promise(() => fetchStreamSnapshot(serverQueryClient, serverOptions))
            : yield* Effect.promise(() => fetchStreamSnapshot(serverQueryClient, serverLive)),
          view === 'streamed' ? [1] : 1,
        )
        equal(serverClosed, true)
        const json = JSON.stringify(dehydrate(serverQueryClient))
        serverQueryClient.clear()
        yield* Scope.close(serverScope, Exit.void)
        hydrate(browserQueryClient, JSON.parse(json))
        deepStrictEqual(
          view === 'streamed'
            ? yield* Effect.promise(() =>
                fetchStreamSnapshot(browserQueryClient, browserOptions, { mode: 'cached' }),
              )
            : yield* Effect.promise(() =>
                fetchStreamSnapshot(browserQueryClient, browserLive, { mode: 'cached' }),
              ),
          view === 'streamed' ? [1] : 1,
        )
        equal(browserReads, 0)
        deepStrictEqual(
          view === 'streamed'
            ? yield* Effect.promise(() => fetchStreamSnapshot(browserQueryClient, browserOptions))
            : yield* Effect.promise(() => fetchStreamSnapshot(browserQueryClient, browserLive)),
          view === 'streamed' ? [2] : 2,
        )
        equal(browserReads, 1)
        equal(browserClosed, true)
        browserQueryClient.clear()
      }
    }),
  ),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      let attempts = 0
      const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
        Effect.provide(
          group.toLayer({
            watch: () =>
              Stream.suspend(() => {
                attempts += 1
                return attempts === 1 ? Stream.fail('try again') : Stream.make(1)
              }),
          }),
        ),
      )
      const options = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['retry-snapshot'],
      }).watch.liveOptions({ input: { channel: 'owned' }, retry: 1, retryDelay: 0 })
      const queryClient = new QueryClient()
      equal(yield* Effect.promise(() => fetchStreamSnapshot(queryClient, options)), 1)
      equal(attempts, 2)
      queryClient.clear()
    }),
  ),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      for (const policy of ['reset', 'append', 'replace', 'live'] as const) {
        const entered = yield* Deferred.make<void>()
        const emit = yield* Deferred.make<void>()
        const emitted = yield* Deferred.make<void>()
        let finalized = false
        const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
          Effect.provide(group.toLayer({ watch: () => Stream.succeed(1) })),
        )
        const ready = ((...args: Parameters<typeof client>) =>
          client(args[0], args[1], { ...args[2], asQueue: false }).pipe(
            Stream.flatMap(() =>
              Stream.fromEffect(
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(emit)),
                  Effect.andThen(Deferred.succeed(emitted, undefined)),
                  Effect.as(1),
                ),
              ),
            ),
            Stream.concat(Stream.fromEffect(Effect.never)),
            Stream.ensuring(
              Effect.sync(() => {
                finalized = true
              }),
            ),
          )) as typeof client
        const utils = createRpcQueryUtils(group, { client: ready, keyPrefix: ['cached', policy] })
        const queryClient = new QueryClient()
        let settled = false
        const input = { channel: 'owned' }
        const streamed = utils.watch.streamedOptions({
          input,
          refetchMode: policy === 'live' ? 'reset' : policy,
          retry: false,
          staleTime: 60_000,
        })
        const live = utils.watch.liveOptions({ input, retry: false, staleTime: 60_000 })
        const queryKey = policy === 'live' ? live.queryKey : streamed.queryKey
        if (policy === 'live') queryClient.setQueryData(live.queryKey, 1)
        else queryClient.setQueryData(streamed.queryKey, [0])
        const fetching =
          policy === 'live'
            ? fetchStreamSnapshot(queryClient, live, { timeoutMs: 100 })
            : fetchStreamSnapshot(queryClient, streamed, { timeoutMs: 100 })
        const outcome = fetching.then(
          (value) => {
            settled = true
            return { status: 'success' as const, value }
          },
          (error: unknown) => {
            settled = true
            return { status: 'failure' as const, error }
          },
        )
        yield* Deferred.await(entered)
        equal(settled, false)
        yield* Effect.promise(() =>
          rejects(
            policy === 'live'
              ? fetchStreamSnapshot(queryClient, live)
              : fetchStreamSnapshot(queryClient, streamed),
            /idle query without observers/,
          ),
        )
        if (policy === 'append' || policy === 'replace') {
          deepStrictEqual(
            yield* Effect.promise(() =>
              fetchStreamSnapshot(queryClient, streamed, { mode: 'cached' }),
            ),
            [0],
          )
          equal(finalized, false)
        }
        yield* Deferred.succeed(emit, undefined)
        yield* Deferred.await(emitted)
        const result = yield* Effect.promise(() => outcome)
        equal(finalized, true)
        equal(queryClient.getQueryCache().hasListeners(), false)
        if (policy === 'replace') {
          equal(result.status, 'failure')
          if (result.status === 'failure')
            ok(result.error instanceof DOMException && result.error.name === 'TimeoutError')
          deepStrictEqual(queryClient.getQueryData(queryKey), [0])
        } else {
          equal(result.status, 'success')
          if (result.status === 'success')
            deepStrictEqual(
              result.value,
              policy === 'live' ? 1 : policy === 'append' ? [0, 1] : [1],
            )
        }
        queryClient.clear()
      }
    }),
  ),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
        Effect.provide(group.toLayer({ watch: () => Stream.make(1, 2) })),
      )
      const options = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['completed'],
      }).watch.streamedOptions({
        input: { channel: 'owned' },
        refetchMode: 'replace',
        retry: false,
      })
      const queryClient = new QueryClient()
      queryClient.setQueryData(options.queryKey, [0])
      deepStrictEqual(
        yield* Effect.promise(() => fetchStreamSnapshot(queryClient, options)),
        [1, 2],
      )
      queryClient.setQueryDefaults(options.queryKey, {
        select: (data) => `items:${Array.isArray(data) ? data.length : 0}`,
      })
      equal(
        yield* Effect.promise(() => fetchStreamSnapshot(queryClient, options, { mode: 'cached' })),
        'items:2',
      )
      equal(
        yield* Effect.promise(() =>
          fetchStreamSnapshot(queryClient, { ...options, select: (values) => values.length }),
        ),
        2,
      )
      deepStrictEqual(queryClient.getQueryData(options.queryKey), [1, 2])
      const observer = new QueryObserver(queryClient, { ...options, enabled: false })
      const unsubscribe = observer.subscribe(() => {})
      yield* Effect.promise(() =>
        rejects(fetchStreamSnapshot(queryClient, options), /idle query without observers/),
      )
      equal(
        yield* Effect.promise(() =>
          fetchStreamSnapshot(
            queryClient,
            { ...options, select: (values) => values.length },
            { mode: 'cached' },
          ),
        ),
        2,
      )
      unsubscribe()
      equal(queryClient.getQueryCache().hasListeners(), false)
      queryClient.clear()
    }),
  ),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
        Effect.provide(
          group.toLayer({
            watch: () => Stream.succeed(1).pipe(Stream.concat(Stream.fromEffect(Effect.never))),
          }),
        ),
      )
      for (const cached of [true, false]) {
        for (const view of ['streamed', 'live'] as const) {
          const utils = createRpcQueryUtils(group, {
            client,
            keyPrefix: ['clock-skew', cached, view],
          })
          const queryClient = new QueryClient()
          const input = { channel: 'owned' }
          const future = Date.now() + 60_000
          const streamed = utils.watch.streamedOptions({
            input,
            initialData: [0],
            initialDataUpdatedAt: future,
            retry: false,
          })
          const live = utils.watch.liveOptions({
            input,
            initialData: 0,
            initialDataUpdatedAt: future,
            retry: false,
          })
          if (cached) {
            if (view === 'streamed')
              queryClient.setQueryData(streamed.queryKey, [0], { updatedAt: future })
            else queryClient.setQueryData(live.queryKey, 0, { updatedAt: future })
            const previous =
              view === 'streamed'
                ? yield* Effect.promise(() =>
                    fetchStreamSnapshot(queryClient, streamed, { mode: 'cached' }),
                  )
                : yield* Effect.promise(() =>
                    fetchStreamSnapshot(queryClient, live, { mode: 'cached' }),
                  )
            deepStrictEqual(previous, view === 'streamed' ? [0] : 0)
          }
          const result =
            view === 'streamed'
              ? yield* Effect.promise(() => fetchStreamSnapshot(queryClient, streamed))
              : yield* Effect.promise(() => fetchStreamSnapshot(queryClient, live))
          deepStrictEqual(result, view === 'streamed' ? (cached ? [1] : [0, 1]) : 1)
          equal(queryClient.isFetching(), 0)
          equal(queryClient.getQueryCache().hasListeners(), false)
          queryClient.clear()
        }
      }
      for (const prefix of [true, false]) {
        const utils = createRpcQueryUtils(group, { client, keyPrefix: ['snapshot-hash', prefix] })
        const queryClient = new QueryClient({
          defaultOptions: { queries: { queryKeyHashFn: (key) => `global:${JSON.stringify(key)}` } },
        })
        if (prefix)
          queryClient.setQueryDefaults(utils.watch.key(), {
            queryKeyHashFn: (key) => `prefix:${JSON.stringify(key)}`,
          })
        const options = utils.watch.liveOptions({ input: { channel: 'owned' }, retry: false })
        equal(yield* Effect.promise(() => fetchStreamSnapshot(queryClient, options)), 1)
        equal(queryClient.getQueryData(options.queryKey), 1)
        equal(queryClient.getQueryCache().getAll().length, 1)
        equal(queryClient.getQueryCache().hasListeners(), false)
        queryClient.clear()
      }
    }),
  ),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const undefinedGroup = RpcGroup.make(
        Rpc.make('watch', { success: Schema.Undefined, stream: true }),
      )
      const client = yield* RpcTest.makeClient(undefinedGroup, { flatten: true }).pipe(
        Effect.provide(
          undefinedGroup.toLayer({
            watch: () =>
              Stream.succeed(undefined).pipe(Stream.concat(Stream.fromEffect(Effect.never))),
          }),
        ),
      )
      const options = createRpcQueryUtils(undefinedGroup, {
        client,
        keyPrefix: ['snapshot-null'],
      }).watch.liveOptions({ retry: false })
      const queryClient = new QueryClient()
      equal(yield* Effect.promise(() => fetchStreamSnapshot(queryClient, options)), null)
      equal(queryClient.getQueryData(options.queryKey), null)
      equal(queryClient.isFetching(), 0)
      queryClient.clear()
    }),
  ),
)

for (const extra of [{ queryHash: 'custom' }, { queryKeyHashFn: () => 'custom' }]) {
  const queryClient = new QueryClient()
  await rejects(
    Reflect.apply(fetchStreamSnapshot, undefined, [
      queryClient,
      {
        queryKey: ['per-call-hash'],
        queryFn: () => Promise.resolve(1),
        ...extra,
      },
    ]),
    TypeError,
  )
  equal(queryClient.getQueryCache().getAll().length, 0)
  equal(queryClient.getQueryCache().hasListeners(), false)
}

for (const timeoutMs of [0, -1, Number.POSITIVE_INFINITY, Number.NaN, 2_147_483_648]) {
  const queryClient = new QueryClient()
  await rejects(
    fetchStreamSnapshot(
      queryClient,
      {
        queryKey: ['timeout'],
        queryFn: () => Promise.resolve(1),
      },
      { timeoutMs },
    ),
    RangeError,
  )
  equal(queryClient.getQueryCache().getAll().length, 0)
  equal(queryClient.getQueryCache().hasListeners(), false)
}

const previousOnline = onlineManager.isOnline()
const pausedClient = new QueryClient()
try {
  onlineManager.setOnline(false)
  const options = { queryKey: ['paused'], queryFn: () => Promise.resolve(1) }
  const paused = pausedClient.query(options).catch((error: unknown) => error)
  equal(pausedClient.getQueryState(options.queryKey)?.fetchStatus, 'paused')
  await rejects(fetchStreamSnapshot(pausedClient, options), /idle query without observers/)
  equal(pausedClient.getQueryState(options.queryKey)?.fetchStatus, 'paused')
  equal(pausedClient.getQueryCache().hasListeners(), false)
  await pausedClient.cancelQueries({ exact: true, queryKey: options.queryKey })
  ok(isCancelledError(await paused))
} finally {
  onlineManager.setOnline(previousOnline)
  pausedClient.clear()
}

for (const queryFn of [undefined, skipToken, 'skipToken']) {
  const queryClient = new QueryClient()
  await rejects(
    Reflect.apply(fetchStreamSnapshot, undefined, [
      queryClient,
      {
        queryKey: ['invalid-query-function'],
        queryFn,
      },
    ]),
    TypeError,
  )
  equal(queryClient.getQueryCache().getAll().length, 0)
  equal(queryClient.getQueryCache().hasListeners(), false)
}

console.log(
  'Packed stream snapshots, local cleanup, fresh/cached modes, ownership, hashing, and reconnection executed',
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(updates, { flatten: true }).pipe(
        Effect.provide(
          updates.toLayer({
            'updates.watch': () =>
              Stream.succeed('announcement').pipe(Stream.concat(Stream.fromEffect(Effect.never))),
          }),
        ),
      )
      const queryClient = new QueryClient()
      deepStrictEqual(
        yield* Effect.promise(() =>
          captureUpdates(queryClient, client, new AbortController().signal),
        ),
        {
          history: ['announcement'],
          latest: 'announcement',
        },
      )
      equal(queryClient.isFetching(), 0)
      equal(queryClient.getQueryCache().hasListeners(), false)
      queryClient.clear()
    }),
  ),
)
