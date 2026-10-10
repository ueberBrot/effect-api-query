import { QueryClient } from '@tanstack/query-core'
import type { QueryExecuteOptions, QueryFunction, QueryKey } from '@tanstack/query-core'
import { Deferred, Effect, Exit, Schema, Scope, Stream } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils, fetchStreamSnapshot } from 'effect-api-query'
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

import { Profile } from './docs-hydration-rich.ts'
import {
  ArchivedProfile,
  BufferedProfile,
  Cursor,
  HistoryElement,
  prepareViewHydration,
  prepareViewSnapshot,
  ProfilePage,
  ProfilePages,
  ProfileMetadata,
  SnapshotDecoding,
  SnapshotEncoding,
  WrappedElement,
} from './docs-hydration-views.ts'

const serverProfile = new Profile({
  name: 'Ada',
  credits: 9007199254740993n,
  avatar: new Uint8Array([0, 1, 255]),
})
const browserProfile = new Profile({
  name: 'Grace',
  credits: 9007199254740995n,
  avatar: new Uint8Array([255, 1, 2]),
})
const viewsGroup = RpcGroup.make(
  Rpc.make('page', { payload: { cursor: Schema.Finite }, success: ProfilePage }),
  Rpc.make('watch', { payload: { mode: Schema.String }, success: HistoryElement, stream: true }),
  Rpc.make('empty', { success: Schema.Void }),
)
const viewsApi = HttpApi.make('hydration-views').add(
  HttpApiGroup.make('profiles').add(
    HttpApiEndpoint.get('page', '/page', {
      query: { cursor: Schema.FiniteFromString },
      success: ProfilePage,
    }),
    HttpApiEndpoint.get('watch', '/watch', {
      query: { mode: Schema.String },
      success: HttpApiSchema.StreamSse({ data: HistoryElement }),
    }),
    HttpApiEndpoint.get('empty', '/empty', { success: HttpApiSchema.NoContent }),
  ),
)

const envelopeApi = HttpApi.make('hydration-envelopes').add(
  HttpApiGroup.make('profiles').add(
    HttpApiEndpoint.get('read', '/read', {
      success: [
        HttpApiSchema.WithHeaders(Profile, { 'x-version': Schema.FiniteFromString }),
        HttpApiSchema.WithHeaders(ArchivedProfile, { 'x-version': Schema.FiniteFromString }).pipe(
          HttpApiSchema.status(203),
        ),
      ],
      error: Schema.String,
    }),
    HttpApiEndpoint.get('watch', '/watch', {
      success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamSse({ data: HistoryElement }), {
        'x-version': Schema.FiniteFromString,
      }),
    }),
  ),
)

const encode = (client: QueryClient) =>
  Effect.runPromise(
    prepareViewSnapshot(client).pipe(
      Effect.provideService(SnapshotEncoding, { beforeEncode: Effect.void }),
    ),
  )
const decode = (client: QueryClient, json: string) =>
  Effect.runPromise(
    prepareViewHydration(client, json).pipe(
      Effect.provideService(SnapshotDecoding, { beforeDecode: Effect.void }),
    ),
  )

const finiteValues = (profile: Profile, mode: string) =>
  mode === 'history'
    ? Stream.make(profile, undefined, null)
    : mode === 'null'
      ? Stream.make(profile, undefined)
      : Stream.succeed(profile)

const execution = <TData, E, TKey extends QueryKey>(
  options: QueryExecuteOptions<TData, E, TData, TData, TKey>,
) => ({
  key: options.queryKey,
  execute: (cache: QueryClient): Promise<unknown> => cache.query(options),
})

const snapshotExecution = <TData, E, TKey extends QueryKey>(
  options: QueryExecuteOptions<TData, E, TData, TData, TKey> & {
    readonly queryFn: QueryFunction<TData, TKey>
    readonly queryHash?: never
    readonly queryKeyHashFn?: never
  },
) => ({
  key: options.queryKey,
  capture: (cache: QueryClient, mode: 'fresh' | 'cached'): Promise<unknown> =>
    fetchStreamSnapshot(cache, options, { mode, timeoutMs: 5_000 }),
})

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      for (const transport of ['rpc', 'http'] as const) {
        for (const view of ['history', 'live', 'null', 'empty'] as const) {
          const serverScope = yield* Scope.make()
          const browserScope = yield* Scope.make()
          const server = new QueryClient()
          const browser = new QueryClient()
          let serverReads = 0
          let browserReads = 0
          const makeOptions = Effect.fnUntraced(function* (
            profile: Profile,
            scope: Scope.Scope,
            onRead: () => void,
          ) {
            const mode =
              profile === serverProfile && view === 'null'
                ? 'null'
                : view === 'history'
                  ? 'history'
                  : 'latest'
            const codecId = view === 'history' ? 'history' : 'live'
            if (transport === 'rpc') {
              const client = yield* RpcTest.makeClient(viewsGroup, { flatten: true }).pipe(
                Effect.provide(
                  viewsGroup.toLayer({
                    page: ({ cursor }) =>
                      Effect.succeed({ rows: [profile], next: cursor === 0 ? 1 : null }),
                    watch: () =>
                      Stream.suspend(() => {
                        onRead()
                        return finiteValues(profile, mode)
                      }),
                    empty: () => Effect.sync(onRead),
                  }),
                ),
                Effect.provideService(Scope.Scope, scope),
              )
              const utils = createRpcQueryUtils(viewsGroup, {
                client,
                keyPrefix: ['hydration-views', codecId, 'rpc'],
              })
              return view === 'empty'
                ? execution(utils.empty.queryOptions({ retry: false, staleTime: Infinity }))
                : view === 'history'
                  ? execution(
                      utils.watch.streamedOptions({
                        input: { mode: view },
                        retry: false,
                        staleTime: Infinity,
                      }),
                    )
                  : execution(
                      utils.watch.liveOptions({
                        input: { mode: view },
                        retry: false,
                        staleTime: Infinity,
                      }),
                    )
            }
            const client = yield* HttpApiTest.groups(viewsApi, ['profiles']).pipe(
              Effect.provide(
                HttpApiBuilder.group(viewsApi, 'profiles', (handlers) =>
                  handlers
                    .handle('page', ({ query }) =>
                      Effect.succeed({ rows: [profile], next: query.cursor === 0 ? 1 : null }),
                    )
                    .handle('watch', () =>
                      Effect.sync(() => {
                        onRead()
                        return finiteValues(profile, mode)
                      }),
                    )
                    .handle('empty', () => Effect.sync(onRead)),
                ),
              ),
              Effect.provideService(Scope.Scope, scope),
            )
            const utils = createHttpApiQueryUtils(viewsApi, {
              client,
              keyPrefix: ['hydration-views', codecId, 'http'],
            })
            return view === 'empty'
              ? execution(utils.profiles.empty.queryOptions({ retry: false, staleTime: Infinity }))
              : view === 'history'
                ? execution(
                    utils.profiles.watch.streamedOptions({
                      input: { query: { mode: view } },
                      retry: false,
                      staleTime: Infinity,
                    }),
                  )
                : execution(
                    utils.profiles.watch.liveOptions({
                      input: { query: { mode: view } },
                      retry: false,
                      staleTime: Infinity,
                    }),
                  )
          })
          try {
            const serverOptions = yield* makeOptions(serverProfile, serverScope, () => {
              serverReads += 1
            })
            const browserOptions = yield* makeOptions(browserProfile, browserScope, () => {
              browserReads += 1
            })
            const initial = yield* Effect.promise(() => serverOptions.execute(server))
            if (view === 'history') deepStrictEqual(initial, [serverProfile, undefined, null])
            else
              equal(
                initial instanceof Profile ? initial.summary() : initial,
                view === 'live' ? 'Ada: 9007199254740993 credits' : null,
              )
            const json = yield* Effect.promise(() => encode(server))
            equal(server.getQueryData(serverOptions.key), initial)
            if (view === 'history')
              deepStrictEqual(JSON.parse(json).queries[0].state.data.slice(1), [
                { _tag: 'Undefined' },
                null,
              ])
            yield* Effect.promise(() => server.cancelQueries())
            server.clear()
            yield* Scope.close(serverScope, Exit.void)
            yield* Effect.promise(() => decode(browser, json))
            const restored = yield* Effect.promise(() => browserOptions.execute(browser))
            if (view === 'history') {
              deepStrictEqual(restored, [serverProfile, undefined, null])
              ok(Array.isArray(restored) && restored[0] instanceof Profile)
              equal(restored[0].summary(), 'Ada: 9007199254740993 credits')
            } else
              equal(
                restored instanceof Profile ? restored.summary() : restored,
                view === 'live' ? 'Ada: 9007199254740993 credits' : null,
              )
            equal(browserReads, 0)
            yield* Effect.promise(() =>
              browser.invalidateQueries({
                exact: true,
                queryKey: browserOptions.key,
                refetchType: 'none',
              }),
            )
            const refetched = yield* Effect.promise(() => browserOptions.execute(browser))
            if (view === 'history') {
              deepStrictEqual(refetched, [browserProfile, undefined, null])
              ok(Array.isArray(refetched) && refetched[0] instanceof Profile)
              equal(refetched[0].summary(), 'Grace: 9007199254740995 credits')
            } else
              equal(
                refetched instanceof Profile ? refetched.summary() : refetched,
                view === 'empty' ? null : 'Grace: 9007199254740995 credits',
              )
            equal(serverReads, 1)
            equal(browserReads, 1)
          } finally {
            yield* Effect.promise(() => browser.cancelQueries())
            browser.clear()
            server.clear()
            yield* Scope.close(serverScope, Exit.void)
            yield* Scope.close(browserScope, Exit.void)
          }
        }
      }
    }),
  ).pipe(Effect.provide(HttpServer.layerServices)),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      for (const view of ['history', 'live', 'wrapped-history', 'wrapped-live'] as const) {
        const serverScope = yield* Scope.make()
        const browserScope = yield* Scope.make()
        const server = new QueryClient()
        const browser = new QueryClient()
        let serverReads = 0
        let browserReads = 0
        const makeSnapshot = Effect.fnUntraced(function* (
          scope: Scope.Scope,
          browserSide: boolean,
        ) {
          const stream = () => {
            if (browserSide) browserReads += 1
            else serverReads += 1
            return Stream.succeed(browserSide ? undefined : serverProfile).pipe(
              Stream.concat(Stream.fromEffect(Effect.never)),
            )
          }
          const client = yield* HttpApiTest.groups(viewsApi, ['profiles']).pipe(
            Effect.provide(
              HttpApiBuilder.group(viewsApi, 'profiles', (handlers) =>
                handlers
                  .handle('page', () => Effect.succeed({ rows: [], next: null }))
                  .handle('empty', () => Effect.void)
                  .handle('watch', () => Effect.sync(stream)),
              ),
            ),
            Effect.provideService(Scope.Scope, scope),
          )
          const wrapped = yield* HttpApiTest.groups(envelopeApi, ['profiles']).pipe(
            Effect.provide(
              HttpApiBuilder.group(envelopeApi, 'profiles', (handlers) =>
                handlers
                  .handle('read', () =>
                    Effect.succeed(
                      HttpApiSchema.withHeaders({
                        body: serverProfile,
                        headers: { 'x-version': 4 },
                      }),
                    ),
                  )
                  .handle('watch', () =>
                    Effect.sync(() =>
                      HttpApiSchema.withHeaders({
                        body: stream(),
                        headers: { 'x-version': browserSide ? 7 : 4 },
                      }),
                    ),
                  ),
              ),
            ),
            Effect.provideService(Scope.Scope, scope),
          )
          const utils = createHttpApiQueryUtils(viewsApi, {
            client,
            keyPrefix: ['hydration-views', view, 'http'],
          })
          const wrappedUtils = createHttpApiQueryUtils(envelopeApi, {
            client: wrapped,
            keyPrefix: ['hydration-views', view, 'http'],
          })
          if (view === 'history')
            return snapshotExecution(
              utils.profiles.watch.streamedOptions({
                input: { query: { mode: 'open' } },
                retry: false,
              }),
            )
          if (view === 'live')
            return snapshotExecution(
              utils.profiles.watch.liveOptions({
                input: { query: { mode: 'open' } },
                retry: false,
              }),
            )
          if (view === 'wrapped-history')
            return snapshotExecution(wrappedUtils.profiles.watch.streamedOptions({ retry: false }))
          return snapshotExecution(wrappedUtils.profiles.watch.liveOptions({ retry: false }))
        })
        try {
          const serverOptions = yield* makeSnapshot(serverScope, false)
          const browserOptions = yield* makeSnapshot(browserScope, true)
          const initial = yield* Effect.promise(() => serverOptions.capture(server, 'fresh'))
          equal(server.isFetching(), 0)
          equal(server.getQueryCache().hasListeners(), false)
          if (view === 'history') deepStrictEqual(initial, [serverProfile])
          else if (view === 'live')
            equal(
              initial instanceof Profile ? initial.summary() : initial,
              'Ada: 9007199254740993 credits',
            )
          else
            deepStrictEqual(
              initial,
              view === 'wrapped-history'
                ? [HttpApiSchema.withHeaders({ body: serverProfile, headers: { 'x-version': 4 } })]
                : HttpApiSchema.withHeaders({ body: serverProfile, headers: { 'x-version': 4 } }),
            )
          const json = yield* Effect.promise(() => encode(server))
          equal(server.getQueryData(serverOptions.key), initial)
          server.clear()
          yield* Scope.close(serverScope, Exit.void)
          yield* Effect.promise(() => decode(browser, json))
          const restored = yield* Effect.promise(() => browserOptions.capture(browser, 'cached'))
          deepStrictEqual(restored, initial)
          const restoredProfile =
            view === 'history'
              ? browser.getQueryData<(typeof HistoryElement.Type)[]>(browserOptions.key)?.[0]
              : view === 'live'
                ? browser.getQueryData<typeof HistoryElement.Type>(browserOptions.key)
                : view === 'wrapped-history'
                  ? browser.getQueryData<(typeof WrappedElement.Type)[]>(browserOptions.key)?.[0]
                      ?.body
                  : browser.getQueryData<typeof WrappedElement.Type>(browserOptions.key)?.body
          ok(restoredProfile instanceof Profile)
          equal(restoredProfile.summary(), 'Ada: 9007199254740993 credits')
          equal(browserReads, 0)
          const refetched = yield* Effect.promise(() => browserOptions.capture(browser, 'fresh'))
          if (view === 'history') deepStrictEqual(refetched, [undefined])
          else if (view === 'live') equal(refetched, null)
          else
            deepStrictEqual(
              refetched,
              view === 'wrapped-history'
                ? [HttpApiSchema.withHeaders({ body: undefined, headers: { 'x-version': 7 } })]
                : HttpApiSchema.withHeaders({ body: undefined, headers: { 'x-version': 7 } }),
            )
          const nextJson = yield* Effect.promise(() => encode(browser))
          const recreated = new QueryClient()
          try {
            yield* Effect.promise(() => decode(recreated, nextJson))
            deepStrictEqual(recreated.getQueryData(browserOptions.key), refetched)
          } finally {
            recreated.clear()
          }
          equal(browser.isFetching(), 0)
          equal(browser.getQueryCache().hasListeners(), false)
          equal(serverReads, 1)
          equal(browserReads, 1)
        } finally {
          yield* Effect.promise(() => browser.cancelQueries())
          server.clear()
          browser.clear()
          yield* Scope.close(serverScope, Exit.void)
          yield* Scope.close(browserScope, Exit.void)
        }
      }
    }),
  ).pipe(Effect.provide(HttpServer.layerServices)),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      for (const view of ['buffered', 'metadata'] as const) {
        const serverScope = yield* Scope.make()
        const browserScope = yield* Scope.make()
        const server = new QueryClient()
        const browser = new QueryClient()
        let serverReads = 0
        let browserReads = 0
        let failed = false
        const archived = new ArchivedProfile({
          archived: true,
          name: 'Grace',
          credits: 9007199254740995n,
        })
        const makeRead = Effect.fnUntraced(function* (scope: Scope.Scope, browserSide: boolean) {
          const client = yield* HttpApiTest.groups(envelopeApi, ['profiles']).pipe(
            Effect.provide(
              HttpApiBuilder.group(envelopeApi, 'profiles', (handlers) =>
                handlers
                  .handle('read', () =>
                    Effect.suspend(() => {
                      if (browserSide) browserReads += 1
                      else serverReads += 1
                      return failed
                        ? Effect.fail('private upstream detail')
                        : Effect.succeed(
                            browserSide
                              ? HttpApiSchema.withHeaders({
                                  body: archived,
                                  headers: { 'x-version': 7 },
                                })
                              : HttpApiSchema.withHeaders({
                                  body: serverProfile,
                                  headers: { 'x-version': 4 },
                                }),
                          )
                    }),
                  )
                  .handle('watch', () =>
                    Effect.succeed(
                      HttpApiSchema.withHeaders({
                        body: Stream.empty,
                        headers: { 'x-version': 4 },
                      }),
                    ),
                  ),
              ),
            ),
            Effect.provideService(Scope.Scope, scope),
          )
          const utils = createHttpApiQueryUtils(envelopeApi, {
            client,
            keyPrefix: ['hydration-views', view, 'http'],
          })
          return view === 'metadata'
            ? execution(utils.profiles.read.metadataOptions({ retry: false, staleTime: Infinity }))
            : execution(utils.profiles.read.queryOptions({ retry: false, staleTime: Infinity }))
        })
        try {
          const serverOptions = yield* makeRead(serverScope, false)
          const browserOptions = yield* makeRead(browserScope, true)
          const initial = yield* Effect.promise(() => serverOptions.execute(server))
          const json = yield* Effect.promise(() => encode(server))
          equal(server.getQueryData(serverOptions.key), initial)
          const wire = JSON.parse(json).queries[0].state.data
          equal((view === 'metadata' ? wire.data : wire).body.credits, '9007199254740993')
          equal((view === 'metadata' ? wire.data : wire).headers['x-version'], '4')
          if (view === 'metadata') {
            equal(wire.status, 200)
            equal(wire.headers['x-version'], '4')
            equal(Object.isFrozen(initial), true)
          }
          server.clear()
          failed = true
          yield* Effect.promise(() => rejects(serverOptions.execute(server)))
          const failedJson = yield* Effect.promise(() => encode(server))
          equal(JSON.parse(failedJson).queries.length, 0)
          equal(failedJson.includes('private upstream detail'), false)
          failed = false
          server.clear()
          yield* Scope.close(serverScope, Exit.void)
          yield* Effect.promise(() => decode(browser, json))
          yield* Effect.promise(() => browserOptions.execute(browser))
          const restoredMetadata =
            view === 'metadata'
              ? browser.getQueryData<typeof ProfileMetadata.Type>(browserOptions.key)
              : undefined
          const restored =
            view === 'metadata'
              ? restoredMetadata?.data
              : browser.getQueryData<typeof BufferedProfile.Type>(browserOptions.key)
          ok(restored?.body instanceof Profile)
          equal(restored.body.summary(), 'Ada: 9007199254740993 credits')
          deepStrictEqual(restored.body.avatar, new Uint8Array([0, 1, 255]))
          equal(restored.headers['x-version'], 4)
          if (view === 'metadata') {
            equal(restoredMetadata?.status, 200)
            equal(restoredMetadata?.headers['x-version'], '4')
            equal(Object.isFrozen(restoredMetadata), false)
            equal(Object.isFrozen(restoredMetadata?.headers), false)
          }
          equal(browserReads, 0)
          yield* Effect.promise(() =>
            browser.invalidateQueries({
              exact: true,
              queryKey: browserOptions.key,
              refetchType: 'none',
            }),
          )
          yield* Effect.promise(() => browserOptions.execute(browser))
          const refetchedMetadata =
            view === 'metadata'
              ? browser.getQueryData<typeof ProfileMetadata.Type>(browserOptions.key)
              : undefined
          const refetched =
            view === 'metadata'
              ? refetchedMetadata?.data
              : browser.getQueryData<typeof BufferedProfile.Type>(browserOptions.key)
          ok(refetched?.body instanceof ArchivedProfile)
          equal(refetched.body.summary(), 'Grace: 9007199254740995 archived credits')
          equal(refetched.headers['x-version'], 7)
          if (view === 'metadata') {
            equal(refetchedMetadata?.status, 203)
            equal(refetchedMetadata?.headers['x-version'], '7')
            equal(Object.isFrozen(refetchedMetadata), true)
            equal(Object.isFrozen(refetchedMetadata?.headers), true)
          }
          equal(serverReads, 2)
          equal(browserReads, 1)
          browser.clear()
          yield* Effect.promise(() => decode(browser, failedJson))
          equal(browser.getQueryCache().getAll().length, 0)
          yield* Effect.promise(() => browserOptions.execute(browser))
          equal(browserReads, 2)
        } finally {
          yield* Effect.promise(() => browser.cancelQueries())
          server.clear()
          browser.clear()
          yield* Scope.close(serverScope, Exit.void)
          yield* Scope.close(browserScope, Exit.void)
        }
      }
    }),
  ).pipe(Effect.provide(HttpServer.layerServices)),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      for (const transport of ['rpc', 'http'] as const) {
        const serverScope = yield* Scope.make()
        const browserScope = yield* Scope.make()
        const server = new QueryClient()
        const browser = new QueryClient()
        let serverReads = 0
        let browserReads = 0
        const makePages = Effect.fnUntraced(function* (
          profile: Profile,
          scope: Scope.Scope,
          onRead: () => void,
        ) {
          const read = (cursor: number) =>
            Effect.sync(() => {
              onRead()
              return { rows: [profile], next: cursor === 0 ? 1 : null }
            })
          const policy = {
            initialPageParam: new Cursor({ offset: 0n }),
            getNextPageParam: (page: typeof ProfilePage.Type) =>
              page.next === null ? undefined : new Cursor({ offset: BigInt(page.next) }),
            retry: false,
            staleTime: Infinity,
          }
          if (transport === 'rpc') {
            const client = yield* RpcTest.makeClient(viewsGroup, { flatten: true }).pipe(
              Effect.provide(
                viewsGroup.toLayer({
                  page: ({ cursor }) => read(cursor),
                  watch: () => Stream.empty,
                  empty: () => Effect.void,
                }),
              ),
              Effect.provideService(Scope.Scope, scope),
            )
            const utils = createRpcQueryUtils(viewsGroup, {
              client,
              keyPrefix: ['hydration-views', 'infinite', 'rpc'],
            })
            const options = utils.page.infiniteOptions({
              ...policy,
              input: (cursor) => ({ cursor: Number(cursor.offset) }),
            })
            return {
              key: options.queryKey,
              execute: (cache: QueryClient): Promise<unknown> =>
                cache.infiniteQuery({ ...options, pages: 2 }),
            }
          }
          const client = yield* HttpApiTest.groups(viewsApi, ['profiles']).pipe(
            Effect.provide(
              HttpApiBuilder.group(viewsApi, 'profiles', (handlers) =>
                handlers
                  .handle('page', ({ query }) => read(query.cursor))
                  .handle('watch', () => Effect.succeed(Stream.empty))
                  .handle('empty', () => Effect.void),
              ),
            ),
            Effect.provideService(Scope.Scope, scope),
          )
          const utils = createHttpApiQueryUtils(viewsApi, {
            client,
            keyPrefix: ['hydration-views', 'infinite', 'http'],
          })
          const options = utils.profiles.page.infiniteOptions({
            ...policy,
            input: (cursor) => ({ query: { cursor: Number(cursor.offset) } }),
          })
          return {
            key: options.queryKey,
            execute: (cache: QueryClient): Promise<unknown> =>
              cache.infiniteQuery({ ...options, pages: 2 }),
          }
        })
        try {
          const serverOptions = yield* makePages(serverProfile, serverScope, () => {
            serverReads += 1
          })
          const browserOptions = yield* makePages(browserProfile, browserScope, () => {
            browserReads += 1
          })
          yield* Effect.promise(() => serverOptions.execute(server))
          const initial = server.getQueryData<typeof ProfilePages.Type>(serverOptions.key)
          ok(initial)
          equal(initial.pages.length, 2)
          equal(initial.pages[0]?.rows[0]?.summary(), 'Ada: 9007199254740993 credits')
          equal(initial.pages[1]?.rows[0]?.summary(), 'Ada: 9007199254740993 credits')
          equal(initial.pages[0]?.next, 1)
          equal(initial.pages[1]?.next, null)
          deepStrictEqual(
            initial.pageParams.map((cursor) => cursor.offset),
            [0n, 1n],
          )
          deepStrictEqual(
            initial.pageParams.map((cursor) => cursor.isStart()),
            [true, false],
          )
          const json = yield* Effect.promise(() => encode(server))
          deepStrictEqual(JSON.parse(json).queries[0].state.data.pageParams, [
            { offset: '0' },
            { offset: '1' },
          ])
          equal(server.getQueryData(serverOptions.key), initial)
          server.clear()
          yield* Scope.close(serverScope, Exit.void)
          yield* Effect.promise(() => decode(browser, json))
          yield* Effect.promise(() => browserOptions.execute(browser))
          const restored = browser.getQueryData<typeof ProfilePages.Type>(browserOptions.key)
          ok(restored)
          ok(restored.pages[0]?.rows[0] instanceof Profile)
          ok(restored.pages[1]?.rows[0] instanceof Profile)
          equal(restored.pages[1]?.rows[0]?.summary(), 'Ada: 9007199254740993 credits')
          deepStrictEqual(
            restored.pageParams.map((cursor) => cursor.offset),
            [0n, 1n],
          )
          deepStrictEqual(
            restored.pageParams.map((cursor) => cursor.isStart()),
            [true, false],
          )
          equal(browserReads, 0)
          yield* Effect.promise(() =>
            browser.invalidateQueries({
              exact: true,
              queryKey: browserOptions.key,
              refetchType: 'none',
            }),
          )
          yield* Effect.promise(() => browserOptions.execute(browser))
          const refetched = browser.getQueryData<typeof ProfilePages.Type>(browserOptions.key)
          ok(refetched)
          equal(refetched.pages[0]?.rows[0]?.summary(), 'Grace: 9007199254740995 credits')
          equal(refetched.pages[1]?.rows[0]?.summary(), 'Grace: 9007199254740995 credits')
          deepStrictEqual(
            refetched.pageParams.map((cursor) => cursor.offset),
            [0n, 1n],
          )
          deepStrictEqual(
            refetched.pageParams.map((cursor) => cursor.isStart()),
            [true, false],
          )
          equal(serverReads, 2)
          equal(browserReads, 2)
        } finally {
          yield* Effect.promise(() => browser.cancelQueries())
          server.clear()
          browser.clear()
          yield* Scope.close(serverScope, Exit.void)
          yield* Scope.close(browserScope, Exit.void)
        }
      }
    }),
  ).pipe(Effect.provide(HttpServer.layerServices)),
)

await Effect.runPromise(
  Effect.gen(function* () {
    const server = new QueryClient()
    const browser = new QueryClient()
    const untouched = new QueryClient()
    const historyKey = ['hydration-views', 'history', 'application'] as const
    const infiniteKey = ['hydration-views', 'infinite', 'application'] as const
    const metadataKey = ['hydration-views', 'metadata', 'application'] as const
    const history = [serverProfile, undefined, null]
    server.setQueryData(historyKey, history)
    server.setQueryData(infiniteKey, {
      pages: [{ rows: [serverProfile], next: null }],
      pageParams: [new Cursor({ offset: 0n })],
    })
    server.setQueryData(metadataKey, {
      data: HttpApiSchema.withHeaders({ body: serverProfile, headers: { 'x-version': 4 } }),
      status: 200,
      headers: { 'x-version': '4' },
    })
    const encodingStarted = yield* Deferred.make<void>()
    const encodingAllowed = yield* Deferred.make<void>()
    const decodingStarted = yield* Deferred.make<void>()
    const decodingAllowed = yield* Deferred.make<void>()
    let published: string | undefined
    try {
      const encoding = Effect.runPromise(
        prepareViewSnapshot(server).pipe(
          Effect.provideService(SnapshotEncoding, {
            beforeEncode: Deferred.succeed(encodingStarted, undefined).pipe(
              Effect.andThen(Deferred.await(encodingAllowed)),
            ),
          }),
        ),
      ).then((json) => {
        published = json
        return json
      })
      yield* Deferred.await(encodingStarted)
      equal(published, undefined)
      equal(server.getQueryData(historyKey), history)
      yield* Deferred.succeed(encodingAllowed, undefined)
      const json = yield* Effect.promise(() => encoding)
      equal(JSON.parse(json).queries.length, 3)
      equal(server.getQueryData(historyKey), history)
      const decoding = Effect.runPromise(
        prepareViewHydration(browser, json).pipe(
          Effect.provideService(SnapshotDecoding, {
            beforeDecode: Deferred.succeed(decodingStarted, undefined).pipe(
              Effect.andThen(Deferred.await(decodingAllowed)),
            ),
          }),
        ),
      )
      yield* Deferred.await(decodingStarted)
      equal(browser.getQueryCache().getAll().length, 0)
      yield* Deferred.succeed(decodingAllowed, undefined)
      yield* Effect.promise(() => decoding)
      deepStrictEqual(browser.getQueryData(historyKey), [serverProfile, undefined, null])
      equal(
        browser.getQueryData<typeof ProfilePages.Type>(infiniteKey)?.pageParams[0]?.isStart(),
        true,
      )
      const metadata = browser.getQueryData<typeof ProfileMetadata.Type>(metadataKey)
      ok(metadata?.data.body instanceof Profile)
      equal(metadata.data.body.summary(), 'Ada: 9007199254740993 credits')
      deepStrictEqual(
        metadata.data,
        HttpApiSchema.withHeaders({ body: serverProfile, headers: { 'x-version': 4 } }),
      )
      const invalid = JSON.parse(json)
      invalid.queries[2].state.data.data.body.credits = 'not a bigint'
      yield* Effect.promise(() => rejects(decode(untouched, JSON.stringify(invalid))))
      equal(untouched.getQueryCache().getAll().length, 0)
      const unknown = JSON.parse(json)
      unknown.queries[2].queryKey[1] = 'unsupported-codec'
      yield* Effect.promise(() => rejects(decode(untouched, JSON.stringify(unknown))))
      equal(untouched.getQueryCache().getAll().length, 0)
    } finally {
      server.clear()
      browser.clear()
      untouched.clear()
    }
  }),
)
