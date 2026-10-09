import { dehydrate, hydrate, QueryClient, QueryObserver, isCancelledError } from '@tanstack/query-core'
import { Deferred, Effect, Exit, Schema, Scope, Stream } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils, fetchStreamSnapshot, isEffectRpcQueryError } from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'
import { HttpServer } from 'effect/http'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, HttpApiTest } from 'effect/http-api'
import { deepStrictEqual, equal, ok, rejects } from 'node:assert/strict'
import { getEventListeners } from 'node:events'

const group = RpcGroup.make(Rpc.make('watch', {
  payload: { channel: Schema.String }, success: Schema.Int, error: Schema.String, stream: true,
}))
const api = HttpApi.make('snapshot-http').add(HttpApiGroup.make('events').add(
  HttpApiEndpoint.get('watch', '/watch', { success: HttpApiSchema.StreamSse({ data: Schema.Int }) }),
))

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const client = yield* HttpApiTest.groups(api, ['events']).pipe(
    Effect.provide(HttpApiBuilder.group(api, 'events', (handlers) =>
      handlers.handle('watch', () => Effect.succeed(Stream.succeed(1).pipe(Stream.concat(Stream.fromEffect(Effect.never))))),
    )),
  )
  const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['snapshot-http'] })
  const queryClient = new QueryClient()
  deepStrictEqual(yield* Effect.promise(() => fetchStreamSnapshot(queryClient, utils.events.watch.streamedOptions({ retry: false }))), [1])
  equal(queryClient.isFetching(), 0)
  equal(queryClient.getQueryCache().hasListeners(), false)
  queryClient.clear()
})).pipe(Effect.provide(HttpServer.layerServices)))

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  for (const view of ['streamed', 'live'] as const) {
    for (const path of ['success', 'timeout', 'abort', 'external cancel', 'failure', 'empty', 'complete'] as const) {
      const entered = yield* Deferred.make<void>()
      const closing = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let finalized = false
      const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
        Effect.provide(group.toLayer({ watch: () => Stream.succeed(1) })),
      )
      const source = path === 'failure' ? Stream.fail('unavailable')
        : path === 'empty' ? Stream.empty
        : path === 'complete' ? Stream.make(1, 2)
        : path === 'success' ? Stream.succeed(1).pipe(Stream.concat(Stream.fromEffect(Effect.never)))
        : Stream.fromEffect(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)))
      const ready: typeof client = (...args) => client(...args).pipe(
        Stream.flatMap(() => source),
        Stream.ensuring(Deferred.succeed(closing, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(Effect.sync(() => { finalized = true })),
        )),
      )
      const options = createRpcQueryUtils(group, { client: ready, keyPrefix: ['snapshot', path] }).watch
      const queryClient = new QueryClient()
      const abort = new AbortController()
      const reason = new Error('page aborted')
      let settled = false
      const nativeOptions = view === 'streamed'
        ? options.streamedOptions({ input: { channel: 'owned' }, retry: false })
        : options.liveOptions({ input: { channel: 'owned' }, retry: false })
      const queryKey = nativeOptions.queryKey
      const snapshot = view === 'streamed'
        ? fetchStreamSnapshot(queryClient, options.streamedOptions({ input: { channel: 'owned' }, retry: false }), { signal: abort.signal, timeoutMs: path === 'timeout' ? 10 : 1_000 })
        : fetchStreamSnapshot(queryClient, options.liveOptions({ input: { channel: 'owned' }, retry: false }), { signal: abort.signal, timeoutMs: path === 'timeout' ? 10 : 1_000 })
      const outcome = snapshot.then(
        (data) => { settled = true; return { status: 'success' as const, data } },
        (error: unknown) => { settled = true; return { status: 'failure' as const, error } },
      )
      if (path === 'abort' || path === 'external cancel') {
        yield* Deferred.await(entered)
        if (path === 'abort') abort.abort(reason)
        else yield* Effect.promise(() => queryClient.cancelQueries({ exact: true, queryKey }))
      }
      yield* Deferred.await(closing)
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
          else ok(result.error instanceof Error && result.error.name === 'EffectRpcQueryEmptyStreamError')
        }
      } else {
        equal(result.status, 'success')
        if (result.status === 'success') deepStrictEqual(result.data, view === 'streamed' ? path === 'empty' ? [] : [1] : 1)
      }
      abort.abort(new Error('late abort'))
      equal(queryClient.getQueryCache().hasListeners(), false)
      queryClient.clear()
    }
  }
})))

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const acquiring = yield* Deferred.make<void>()
  const allow = yield* Deferred.make<void>()
  let acquisitionFinalized = false
  let reads = 0
  const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
    Effect.provide(group.toLayer({ watch: () => Stream.fromEffect(Effect.sync(() => { reads += 1; return 1 })) })),
  )
  const runPromiseExit: RunPromiseExit = (effect, options) => Effect.runPromiseExit(
    Deferred.succeed(acquiring, undefined).pipe(
      Effect.andThen(Deferred.await(allow)),
      Effect.andThen(effect),
      Effect.ensuring(Effect.sync(() => { acquisitionFinalized = true })),
    ), options,
  )
  const options = createRpcQueryUtils(group, { client, keyPrefix: ['acquisition'], runPromiseExit }).watch.liveOptions({ input: { channel: 'owned' }, retry: false })
  const queryClient = new QueryClient()
  const before = AbortSignal.abort(new Error('already aborted'))
  yield* Effect.promise(() => rejects(fetchStreamSnapshot(queryClient, options, { signal: before }), (error: unknown) => error === before.reason))
  equal(queryClient.getQueryCache().getAll().length, 0)
  const abort = new AbortController()
  const reason = new Error('abort acquisition')
  const outcome = rejects(fetchStreamSnapshot(queryClient, options, { signal: abort.signal }), (error: unknown) => error === reason)
  yield* Deferred.await(acquiring)
  abort.abort(reason)
  yield* Effect.promise(() => outcome)
  equal(acquisitionFinalized, true)
  equal(reads, 0)
  equal(getEventListeners(abort.signal, 'abort').length, 0)
  equal(queryClient.getQueryCache().hasListeners(), false)
  queryClient.clear()
})))

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  let ownedClosed = false
  let otherClosed = false
  const started = yield* Deferred.make<void>()
  const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
    Effect.provide(group.toLayer({ watch: ({ channel }) => Stream.succeed(channel === 'owned' ? 1 : 2).pipe(Stream.concat(Stream.fromEffect(Effect.never))) })),
  )
  const ready: typeof client = (...args) => client(...args).pipe(
    Stream.ensuring(Effect.sync(() => { if (args[1].channel === 'owned') ownedClosed = true; else otherClosed = true })),
  )
  const utils = createRpcQueryUtils(group, { client: ready, keyPrefix: ['exact'] })
  const queryClient = new QueryClient()
  const other = utils.watch.liveOptions({ input: { channel: 'other' }, retry: false })
  const stop = queryClient.getQueryCache().subscribe(() => {
    if (queryClient.getQueryData(other.queryKey) === 2) Effect.runFork(Deferred.succeed(started, undefined))
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
  yield* Effect.promise(() => queryClient.cancelQueries({ exact: true, queryKey: other.queryKey }))
  yield* Effect.promise(() => fetching)
  equal(queryClient.getQueryCache().hasListeners(), false)
  queryClient.clear()
})))

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const serverScope = yield* Scope.make()
  let serverClosed = false
  let browserClosed = false
  let browserReads = 0
  const server = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
    Effect.provide(group.toLayer({ watch: () => Stream.succeed(1).pipe(Stream.concat(Stream.fromEffect(Effect.never))) })),
    Effect.provideService(Scope.Scope, serverScope),
  )
  const browser = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
    Effect.provide(group.toLayer({ watch: () => Stream.fromEffect(Effect.sync(() => { browserReads += 1; return 2 })).pipe(Stream.concat(Stream.fromEffect(Effect.never))) })),
  )
  const serverReady: typeof server = (...args) => server(...args).pipe(Stream.ensuring(Effect.sync(() => { serverClosed = true })))
  const browserReady: typeof browser = (...args) => browser(...args).pipe(Stream.ensuring(Effect.sync(() => { browserClosed = true })))
  const serverOptions = createRpcQueryUtils(group, { client: serverReady, keyPrefix: ['hydrate'] }).watch.streamedOptions({ input: { channel: 'owned' }, retry: false })
  const browserOptions = createRpcQueryUtils(group, { client: browserReady, keyPrefix: ['hydrate'] }).watch.streamedOptions({ input: { channel: 'owned' }, retry: false })
  const serverQueryClient = new QueryClient()
  const browserQueryClient = new QueryClient()
  deepStrictEqual(yield* Effect.promise(() => fetchStreamSnapshot(serverQueryClient, serverOptions)), [1])
  equal(serverClosed, true)
  const json = JSON.stringify(dehydrate(serverQueryClient))
  serverQueryClient.clear()
  yield* Scope.close(serverScope, Exit.void)
  hydrate(browserQueryClient, JSON.parse(json))
  deepStrictEqual(yield* Effect.promise(() => fetchStreamSnapshot(browserQueryClient, browserOptions, { mode: 'cached' })), [1])
  equal(browserReads, 0)
  deepStrictEqual(yield* Effect.promise(() => fetchStreamSnapshot(browserQueryClient, browserOptions)), [2])
  equal(browserReads, 1)
  equal(browserClosed, true)
  browserQueryClient.clear()
})))

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  let attempts = 0
  const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
    Effect.provide(group.toLayer({ watch: () => Stream.suspend(() => {
      attempts += 1
      return attempts === 1 ? Stream.fail('try again') : Stream.make(1)
    }) })),
  )
  const options = createRpcQueryUtils(group, { client, keyPrefix: ['retry-snapshot'] }).watch.liveOptions({ input: { channel: 'owned' }, retry: 1, retryDelay: 0 })
  const queryClient = new QueryClient()
  equal(yield* Effect.promise(() => fetchStreamSnapshot(queryClient, options)), 1)
  equal(attempts, 2)
  queryClient.clear()
})))

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  for (const policy of ['reset', 'append', 'replace', 'live'] as const) {
    const entered = yield* Deferred.make<void>()
    const emit = yield* Deferred.make<void>()
    const emitted = yield* Deferred.make<void>()
    let finalized = false
    const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
      Effect.provide(group.toLayer({ watch: () => Stream.succeed(1) })),
    )
    const ready: typeof client = (...args) => client(...args).pipe(
      Stream.flatMap(() => Stream.fromEffect(
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(emit)),
          Effect.andThen(Deferred.succeed(emitted, undefined)),
          Effect.as(1),
        ),
      )),
      Stream.concat(Stream.fromEffect(Effect.never)),
      Stream.ensuring(Effect.sync(() => { finalized = true })),
    )
    const utils = createRpcQueryUtils(group, { client: ready, keyPrefix: ['cached', policy] })
    const queryClient = new QueryClient()
    let settled = false
    const input = { channel: 'owned' }
    const streamed = utils.watch.streamedOptions({ input, refetchMode: policy === 'live' ? 'reset' : policy, retry: false, staleTime: 60_000 })
    const live = utils.watch.liveOptions({ input, retry: false, staleTime: 60_000 })
    const queryKey = policy === 'live' ? live.queryKey : streamed.queryKey
    if (policy === 'live') queryClient.setQueryData(live.queryKey, 1)
    else queryClient.setQueryData(streamed.queryKey, [0])
    const fetching = policy === 'live'
      ? fetchStreamSnapshot(queryClient, live, { timeoutMs: 100 })
      : fetchStreamSnapshot(queryClient, streamed, { timeoutMs: 100 })
    const outcome = fetching.then(
      (value) => { settled = true; return { status: 'success' as const, value } },
      (error: unknown) => { settled = true; return { status: 'failure' as const, error } },
    )
    yield* Deferred.await(entered)
    equal(settled, false)
    yield* Effect.promise(() => rejects(
      policy === 'live' ? fetchStreamSnapshot(queryClient, live) : fetchStreamSnapshot(queryClient, streamed),
      /idle query without observers/,
    ))
    if (policy === 'append' || policy === 'replace') {
      deepStrictEqual(yield* Effect.promise(() => fetchStreamSnapshot(queryClient, streamed, { mode: 'cached' })), [0])
      equal(finalized, false)
    }
    yield* Deferred.succeed(emit, undefined)
    yield* Deferred.await(emitted)
    const result = yield* Effect.promise(() => outcome)
    equal(finalized, true)
    equal(queryClient.getQueryCache().hasListeners(), false)
    if (policy === 'replace') {
      equal(result.status, 'failure')
      if (result.status === 'failure') ok(result.error instanceof DOMException && result.error.name === 'TimeoutError')
      deepStrictEqual(queryClient.getQueryData(queryKey), [0])
    } else {
      equal(result.status, 'success')
      if (result.status === 'success') deepStrictEqual(result.value, policy === 'live' ? 1 : policy === 'append' ? [0, 1] : [1])
    }
    queryClient.clear()
  }
})))

await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
    Effect.provide(group.toLayer({ watch: () => Stream.make(1, 2) })),
  )
  const options = createRpcQueryUtils(group, { client, keyPrefix: ['completed'] }).watch.streamedOptions({
    input: { channel: 'owned' }, refetchMode: 'replace', retry: false,
  })
  const queryClient = new QueryClient()
  queryClient.setQueryData(options.queryKey, [0])
  deepStrictEqual(yield* Effect.promise(() => fetchStreamSnapshot(queryClient, options)), [1, 2])
  queryClient.setQueryDefaults(options.queryKey, { select: (data) => `items:${Array.isArray(data) ? data.length : 0}` })
  equal(yield* Effect.promise(() => fetchStreamSnapshot(queryClient, options, { mode: 'cached' })), 'items:2')
  equal(yield* Effect.promise(() => fetchStreamSnapshot(queryClient, { ...options, select: (values) => values.length })), 2)
  deepStrictEqual(queryClient.getQueryData(options.queryKey), [1, 2])
  const observer = new QueryObserver(queryClient, { ...options, enabled: false })
  const unsubscribe = observer.subscribe(() => {})
  yield* Effect.promise(() => rejects(fetchStreamSnapshot(queryClient, options), /idle query without observers/))
  equal(yield* Effect.promise(() => fetchStreamSnapshot(queryClient, { ...options, select: (values) => values.length }, { mode: 'cached' })), 2)
  unsubscribe()
  equal(queryClient.getQueryCache().hasListeners(), false)
  queryClient.clear()
})))
