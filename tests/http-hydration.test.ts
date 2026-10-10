import { it } from '@effect/vitest'
import { QueryClient } from '@tanstack/query-core'
import { Deferred, Effect, Exit, Schema, Scope, Stream } from 'effect'
import { HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from 'effect/http-api'
import { expect } from 'vite-plus/test'

import { createHttpApiQueryUtils, fetchStreamSnapshot } from '#effect-api-query'

import { Profile } from './types/docs-hydration-rich.ts'
import {
  ArchivedProfile,
  HistoryElement,
  prepareViewHydration,
  prepareViewSnapshot,
  SnapshotDecoding,
  SnapshotEncoding,
} from './types/docs-hydration-views.ts'

it.effect('hydrates rich HTTP metadata and refetches an alternate declared success', () =>
  Effect.gen(function* () {
    const api = HttpApi.make('hydration-metadata').add(
      HttpApiGroup.make('profiles').add(
        HttpApiEndpoint.get('read', '/read', {
          success: [
            HttpApiSchema.WithHeaders(Profile, { 'x-version': Schema.FiniteFromString }),
            HttpApiSchema.WithHeaders(ArchivedProfile, {
              'x-version': Schema.FiniteFromString,
            }).pipe(HttpApiSchema.status(203)),
          ],
        }),
      ),
    )
    const profile = new Profile({
      name: 'Ada',
      credits: 9_007_199_254_740_993n,
      avatar: new Uint8Array([0, 1, 255]),
    })
    const archived = new ArchivedProfile({ archived: true, name: 'Grace', credits: 42n })
    const serverScope = yield* Scope.make()
    const browserScope = yield* Scope.make()
    const server = new QueryClient()
    const browser = new QueryClient()
    const restored = new QueryClient()
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        server.clear()
        browser.clear()
        restored.clear()
        yield* Scope.close(serverScope, Exit.void)
        yield* Scope.close(browserScope, Exit.void)
      }),
    )
    let serverReads = 0
    let browserReads = 0
    let encoded = 0
    let decoded = 0
    const encoding = {
      beforeEncode: Effect.sync(() => {
        encoded += 1
      }),
    }
    const decoding = {
      beforeDecode: Effect.sync(() => {
        decoded += 1
      }),
    }
    const serverClient = yield* HttpApiTest.groups(api, ['profiles']).pipe(
      Effect.provide(
        HttpApiBuilder.group(api, 'profiles', (handlers) =>
          handlers.handle('read', () =>
            Effect.sync(() => {
              serverReads += 1
              return HttpApiSchema.withHeaders({ body: profile, headers: { 'x-version': 4 } })
            }),
          ),
        ),
      ),
      Effect.provideService(Scope.Scope, serverScope),
    )
    const browserClient = yield* HttpApiTest.groups(api, ['profiles']).pipe(
      Effect.provide(
        HttpApiBuilder.group(api, 'profiles', (handlers) =>
          handlers.handle('read', () =>
            Effect.sync(() => {
              browserReads += 1
              return HttpApiSchema.withHeaders({ body: archived, headers: { 'x-version': 7 } })
            }),
          ),
        ),
      ),
      Effect.provideService(Scope.Scope, browserScope),
    )
    const serverOptions = createHttpApiQueryUtils(api, {
      client: serverClient,
      keyPrefix: ['hydration-views', 'metadata'],
    }).profiles.read.metadataOptions({ retry: false, staleTime: Infinity })
    const browserOptions = createHttpApiQueryUtils(api, {
      client: browserClient,
      keyPrefix: ['hydration-views', 'metadata'],
    }).profiles.read.metadataOptions({ retry: false, staleTime: Infinity })
    const initial = yield* Effect.promise(async () => await server.query(serverOptions))
    const json = yield* prepareViewSnapshot(server).pipe(
      Effect.provideService(SnapshotEncoding, encoding),
    )
    expect(server.getQueryData(serverOptions.queryKey)).toBe(initial)
    expect(initial.data.body).toBeInstanceOf(Profile)
    expect(initial.status).toBe(200)
    server.clear()
    yield* Scope.close(serverScope, Exit.void)
    yield* prepareViewHydration(browser, json).pipe(
      Effect.provideService(SnapshotDecoding, decoding),
    )
    const hydrated = yield* Effect.promise(async () => await browser.query(browserOptions))
    expect(browserReads).toBe(0)
    expect(hydrated.data).toStrictEqual(
      HttpApiSchema.withHeaders({ body: profile, headers: { 'x-version': 4 } }),
    )
    expect(hydrated.data.body).toBeInstanceOf(Profile)
    if (!(hydrated.data.body instanceof Profile)) {
      throw new TypeError('Expected a hydrated Profile')
    }
    expect(hydrated.data.body.summary()).toBe('Ada: 9007199254740993 credits')
    expect(hydrated.data.body.avatar).toStrictEqual(new Uint8Array([0, 1, 255]))
    expect(hydrated.data.headers['x-version']).toBe(4)
    expect(hydrated.status).toBe(200)
    expect(hydrated.headers['x-version']).toBe('4')
    yield* Effect.promise(async () => {
      await browser.invalidateQueries({
        queryKey: browserOptions.queryKey,
        exact: true,
        refetchType: 'none',
      })
    })
    const refreshed = yield* Effect.promise(async () => await browser.query(browserOptions))
    expect(refreshed.data.body).toBeInstanceOf(ArchivedProfile)
    expect(refreshed.data.body.summary()).toBe('Grace: 42 archived credits')
    expect(refreshed.data.headers['x-version']).toBe(7)
    expect(refreshed.status).toBe(203)
    expect(refreshed.headers['x-version']).toBe('7')
    expect(Object.isFrozen(refreshed)).toBe(true)
    expect(Object.isFrozen(refreshed.headers)).toBe(true)
    const refreshedJson = yield* prepareViewSnapshot(browser).pipe(
      Effect.provideService(SnapshotEncoding, encoding),
    )
    yield* prepareViewHydration(restored, refreshedJson).pipe(
      Effect.provideService(SnapshotDecoding, decoding),
    )
    const restoredMetadata = restored.getQueryData(browserOptions.queryKey)
    expect(restoredMetadata?.data).toStrictEqual(
      HttpApiSchema.withHeaders({ body: archived, headers: { 'x-version': 7 } }),
    )
    expect(restoredMetadata?.data.body).toBeInstanceOf(ArchivedProfile)
    expect(restoredMetadata?.data.body.summary()).toBe('Grace: 42 archived credits')
    expect(restoredMetadata).toMatchObject({
      status: 203,
      headers: { 'x-version': '7' },
      data: { headers: { 'x-version': 7 } },
    })
    expect([serverReads, browserReads, encoded, decoded]).toStrictEqual([1, 1, 2, 2])
  }).pipe(Effect.provide(HttpServer.layerServices)),
)

it.effect('hydrates a wrapped SSE snapshot and reconnects with independent browser resources', () =>
  Effect.gen(function* () {
    const api = HttpApi.make('hydration-sse').add(
      HttpApiGroup.make('profiles').add(
        HttpApiEndpoint.get('watch', '/watch', {
          success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamSse({ data: HistoryElement }), {
            'x-version': Schema.FiniteFromString,
          }),
        }),
      ),
    )
    const profile = new Profile({
      name: 'Ada',
      credits: 9_007_199_254_740_993n,
      avatar: new Uint8Array([0, 1, 255]),
    })
    const serverClosed = yield* Deferred.make<undefined>()
    const browserClosed = yield* Deferred.make<undefined>()
    const serverScope = yield* Scope.make()
    const browserScope = yield* Scope.make()
    const server = new QueryClient()
    const browser = new QueryClient()
    const restored = new QueryClient()
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await server.cancelQueries()
          await browser.cancelQueries()
        })
        server.clear()
        browser.clear()
        restored.clear()
        yield* Scope.close(serverScope, Exit.void)
        yield* Scope.close(browserScope, Exit.void)
      }),
    )
    let serverReads = 0
    let browserReads = 0
    const serverClient = yield* HttpApiTest.groups(api, ['profiles']).pipe(
      Effect.provide(
        HttpApiBuilder.group(api, 'profiles', (handlers) =>
          handlers.handle('watch', () =>
            Effect.sync(() => {
              serverReads += 1
              return HttpApiSchema.withHeaders({
                body: Stream.make(profile).pipe(
                  Stream.concat(Stream.never),
                  Stream.ensuring(Deferred.succeed(serverClosed, undefined)),
                ),
                headers: { 'x-version': 4 },
              })
            }),
          ),
        ),
      ),
      Effect.provideService(Scope.Scope, serverScope),
    )
    const browserClient = yield* HttpApiTest.groups(api, ['profiles']).pipe(
      Effect.provide(
        HttpApiBuilder.group(api, 'profiles', (handlers) =>
          handlers.handle('watch', () =>
            Effect.sync(() => {
              browserReads += 1
              return HttpApiSchema.withHeaders({
                body: Stream.make(undefined).pipe(
                  Stream.concat(Stream.never),
                  Stream.ensuring(Deferred.succeed(browserClosed, undefined)),
                ),
                headers: { 'x-version': 7 },
              })
            }),
          ),
        ),
      ),
      Effect.provideService(Scope.Scope, browserScope),
    )
    const serverOptions = createHttpApiQueryUtils(api, {
      client: serverClient,
      keyPrefix: ['hydration-views', 'wrapped-live'],
    }).profiles.watch.liveOptions({ retry: false })
    const browserOptions = createHttpApiQueryUtils(api, {
      client: browserClient,
      keyPrefix: ['hydration-views', 'wrapped-live'],
    }).profiles.watch.liveOptions({ retry: false })
    const initial = yield* Effect.promise(
      async () => await fetchStreamSnapshot(server, serverOptions),
    )
    yield* Deferred.await(serverClosed)
    expect(initial.body).toBeInstanceOf(Profile)
    expect(initial.headers['x-version']).toBe(4)
    const json = yield* prepareViewSnapshot(server).pipe(
      Effect.provideService(SnapshotEncoding, { beforeEncode: Effect.void }),
    )
    expect(server.getQueryData(serverOptions.queryKey)).toBe(initial)
    server.clear()
    yield* Scope.close(serverScope, Exit.void)
    expect(Deferred.isDoneUnsafe(browserClosed)).toBe(false)
    yield* prepareViewHydration(browser, json).pipe(
      Effect.provideService(SnapshotDecoding, { beforeDecode: Effect.void }),
    )
    const hydrated = yield* Effect.promise(
      async () => await fetchStreamSnapshot(browser, browserOptions, { mode: 'cached' }),
    )
    expect(browserReads).toBe(0)
    expect(hydrated).toStrictEqual(
      HttpApiSchema.withHeaders({ body: profile, headers: { 'x-version': 4 } }),
    )
    expect(hydrated.body).toBeInstanceOf(Profile)
    if (!(hydrated.body instanceof Profile)) {
      throw new TypeError('Expected a hydrated Profile')
    }
    expect(hydrated.body.summary()).toBe('Ada: 9007199254740993 credits')
    expect(hydrated.body.avatar).toStrictEqual(new Uint8Array([0, 1, 255]))
    expect(hydrated.headers['x-version']).toBe(4)
    const fresh = yield* Effect.promise(
      async () => await fetchStreamSnapshot(browser, browserOptions),
    )
    yield* Deferred.await(browserClosed)
    expect(fresh).toStrictEqual(
      HttpApiSchema.withHeaders({ body: undefined, headers: { 'x-version': 7 } }),
    )
    expect(fresh.body).toBeUndefined()
    expect(fresh.headers['x-version']).toBe(7)
    const freshJson = yield* prepareViewSnapshot(browser).pipe(
      Effect.provideService(SnapshotEncoding, { beforeEncode: Effect.void }),
    )
    yield* prepareViewHydration(restored, freshJson).pipe(
      Effect.provideService(SnapshotDecoding, { beforeDecode: Effect.void }),
    )
    const restoredSnapshot = restored.getQueryData(browserOptions.queryKey)
    expect(restoredSnapshot).toStrictEqual(
      HttpApiSchema.withHeaders({ body: undefined, headers: { 'x-version': 7 } }),
    )
    expect(restoredSnapshot).toHaveProperty('body', undefined)
    expect(restoredSnapshot?.headers['x-version']).toBe(7)
    expect([serverReads, browserReads]).toStrictEqual([1, 1])
    expect(server.isFetching()).toBe(0)
    expect(browser.isFetching()).toBe(0)
    expect(server.getQueryCache().hasListeners()).toBe(false)
    expect(browser.getQueryCache().hasListeners()).toBe(false)
  }).pipe(Effect.provide(HttpServer.layerServices)),
)
