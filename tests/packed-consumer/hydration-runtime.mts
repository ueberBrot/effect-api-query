import { dehydrate, QueryClient } from '@tanstack/query-core'
import { Deferred, Effect, Exit, Scope } from 'effect'
import { HttpServer } from 'effect/http'
import { HttpApiBuilder, HttpApiTest } from 'effect/http-api'
import { RpcTest } from 'effect/rpc'
import { deepStrictEqual, equal, ok, rejects, throws } from 'node:assert/strict'

import {
  HydrationPreparation,
  prepareProfileHydration,
  prepareProfileSnapshot,
} from './docs-hydration-async.ts'
import {
  dtoApi,
  dtoGroup,
  dtoHttpOptions,
  dtoRpcOptions,
  hydrateDto,
  snapshotDto,
} from './docs-hydration-dto.ts'
import {
  hydrateProfile,
  Profile,
  profileApi,
  profileGroup,
  profileHttpOptions,
  profileRpcOptions,
  snapshotProfile,
} from './docs-hydration-rich.ts'

const serverDto = { name: 'Ada', credits: '9007199254740993', avatar: 'AAH/' }
const browserDto = { name: 'Grace', credits: '9007199254740995', avatar: '/wEC' }

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      for (const transport of ['rpc', 'http'] as const) {
        let serverReads = 0
        let browserReads = 0
        const serverScope = yield* Scope.make()
        const serverClient = new QueryClient()
        const browserClient = new QueryClient()
        try {
          const serverRpc = yield* RpcTest.makeClient(dtoGroup, { flatten: true }).pipe(
            Effect.provide(
              dtoGroup.toLayer({
                'profile.read': () =>
                  Effect.sync(() => {
                    serverReads += 1
                    return serverDto
                  }),
              }),
            ),
            Effect.provideService(Scope.Scope, serverScope),
          )
          const browserRpc = yield* RpcTest.makeClient(dtoGroup, { flatten: true }).pipe(
            Effect.provide(
              dtoGroup.toLayer({
                'profile.read': () =>
                  Effect.sync(() => {
                    browserReads += 1
                    return browserDto
                  }),
              }),
            ),
          )
          const serverHttp = yield* HttpApiTest.groups(dtoApi, ['profile']).pipe(
            Effect.provide(
              HttpApiBuilder.group(dtoApi, 'profile', (handlers) =>
                handlers.handle('read', () =>
                  Effect.sync(() => {
                    serverReads += 1
                    return serverDto
                  }),
                ),
              ),
            ),
            Effect.provideService(Scope.Scope, serverScope),
          )
          const browserHttp = yield* HttpApiTest.groups(dtoApi, ['profile']).pipe(
            Effect.provide(
              HttpApiBuilder.group(dtoApi, 'profile', (handlers) =>
                handlers.handle('read', () =>
                  Effect.sync(() => {
                    browserReads += 1
                    return browserDto
                  }),
                ),
              ),
            ),
          )
          const serverQuery =
            transport === 'rpc'
              ? () => serverClient.query(dtoRpcOptions(serverRpc))
              : () => serverClient.query(dtoHttpOptions(serverHttp))
          const browserQuery =
            transport === 'rpc'
              ? () => browserClient.query(dtoRpcOptions(browserRpc))
              : () => browserClient.query(dtoHttpOptions(browserHttp))
          const browserKey =
            transport === 'rpc'
              ? dtoRpcOptions(browserRpc).queryKey
              : dtoHttpOptions(browserHttp).queryKey
          deepStrictEqual(yield* Effect.promise(serverQuery), serverDto)
          const json = snapshotDto(serverClient)
          equal(typeof json, 'string')
          yield* Effect.promise(() => serverClient.cancelQueries())
          serverClient.clear()
          yield* Scope.close(serverScope, Exit.void)
          hydrateDto(browserClient, json)
          deepStrictEqual(yield* Effect.promise(browserQuery), serverDto)
          equal(browserReads, 0)
          yield* Effect.promise(() => browserClient.invalidateQueries({ queryKey: browserKey }))
          deepStrictEqual(yield* Effect.promise(browserQuery), browserDto)
          equal(serverReads, 1)
          equal(browserReads, 1)
        } finally {
          yield* Effect.promise(() => browserClient.cancelQueries())
          browserClient.clear()
          serverClient.clear()
          yield* Scope.close(serverScope, Exit.void)
        }
      }
    }),
  ).pipe(Effect.provide(HttpServer.layerServices)),
)

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
const cloned = structuredClone(serverProfile)
equal(cloned instanceof Profile, false)
equal('summary' in cloned, false)
equal(cloned.credits, 9007199254740993n)
ok(cloned.avatar instanceof Uint8Array)
throws(() => JSON.stringify(cloned), TypeError)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      for (const transport of ['rpc', 'http'] as const) {
        let serverReads = 0
        let browserReads = 0
        let failed = false
        const serverScope = yield* Scope.make()
        const serverClient = new QueryClient()
        const browserClient = new QueryClient()
        const makeOptions = Effect.fnUntraced(function* (
          profile: Profile,
          onRead: () => void,
          scope: Scope.Scope,
        ) {
          const read = () =>
            Effect.suspend(() => {
              onRead()
              return failed ? Effect.fail('private upstream detail') : Effect.succeed(profile)
            })
          if (transport === 'rpc') {
            const client = yield* RpcTest.makeClient(profileGroup, { flatten: true }).pipe(
              Effect.provide(profileGroup.toLayer({ 'profile.read': read })),
              Effect.provideService(Scope.Scope, scope),
            )
            const options = profileRpcOptions(client)
            return {
              query: (cache: QueryClient) => cache.query(options),
              queryKey: options.queryKey,
            }
          }
          const client = yield* HttpApiTest.groups(profileApi, ['profile']).pipe(
            Effect.provide(
              HttpApiBuilder.group(profileApi, 'profile', (handlers) =>
                handlers.handle('read', read),
              ),
            ),
            Effect.provideService(Scope.Scope, scope),
          )
          const options = profileHttpOptions(client)
          return {
            query: (cache: QueryClient) => cache.query(options),
            queryKey: options.queryKey,
          }
        })
        try {
          const browserScope = yield* Scope.Scope
          const serverOptions = yield* makeOptions(
            serverProfile,
            () => {
              serverReads += 1
            },
            serverScope,
          )
          const browserOptions = yield* makeOptions(
            browserProfile,
            () => {
              browserReads += 1
            },
            browserScope,
          )
          const initial = yield* Effect.promise(() => serverOptions.query(serverClient))
          ok(initial instanceof Profile)
          equal(initial.summary(), 'Ada: 9007199254740993 credits')
          const json = snapshotProfile(serverClient)
          const wire = JSON.parse(json)
          equal(wire.queries[0].state.data.credits, '9007199254740993')
          equal(wire.queries[0].state.data.avatar, 'AAH/')
          serverClient.clear()
          failed = true
          yield* Effect.promise(() => rejects(serverOptions.query(serverClient)))
          equal(dehydrate(serverClient).queries.length, 0)
          const failedJson = snapshotProfile(serverClient)
          equal(JSON.parse(failedJson).queries.length, 0)
          equal(failedJson.includes('private upstream detail'), false)
          failed = false
          yield* Effect.promise(() => serverClient.cancelQueries())
          serverClient.clear()
          yield* Scope.close(serverScope, Exit.void)
          hydrateProfile(browserClient, json)
          const restored = yield* Effect.promise(() => browserOptions.query(browserClient))
          ok(restored instanceof Profile)
          equal(restored.summary(), 'Ada: 9007199254740993 credits')
          equal(restored.credits, 9007199254740993n)
          deepStrictEqual(restored.avatar, new Uint8Array([0, 1, 255]))
          equal(browserReads, 0)
          yield* Effect.promise(() =>
            browserClient.invalidateQueries({ queryKey: browserOptions.queryKey }),
          )
          const refetched = yield* Effect.promise(() => browserOptions.query(browserClient))
          ok(refetched instanceof Profile)
          equal(refetched.summary(), 'Grace: 9007199254740995 credits')
          equal(refetched.credits, 9007199254740995n)
          deepStrictEqual(refetched.avatar, new Uint8Array([255, 1, 2]))
          equal(serverReads, 2)
          equal(browserReads, 1)
          browserClient.clear()
          hydrateProfile(browserClient, failedJson)
          const afterOmittedFailure = yield* Effect.promise(() =>
            browserOptions.query(browserClient),
          )
          ok(afterOmittedFailure instanceof Profile)
          equal(afterOmittedFailure.summary(), 'Grace: 9007199254740995 credits')
          equal(browserReads, 2)
        } finally {
          yield* Effect.promise(() => browserClient.cancelQueries())
          browserClient.clear()
          serverClient.clear()
          yield* Scope.close(serverScope, Exit.void)
        }
      }
    }),
  ).pipe(Effect.provide(HttpServer.layerServices)),
)

await Effect.runPromise(
  Effect.gen(function* () {
    const encodingStarted = yield* Deferred.make<void>()
    const encodingAllowed = yield* Deferred.make<void>()
    const decodingStarted = yield* Deferred.make<void>()
    const decodingAllowed = yield* Deferred.make<void>()
    const preparation = {
      beforeEncode: Deferred.succeed(encodingStarted, undefined).pipe(
        Effect.andThen(Deferred.await(encodingAllowed)),
      ),
      beforeDecode: Deferred.succeed(decodingStarted, undefined).pipe(
        Effect.andThen(Deferred.await(decodingAllowed)),
      ),
    }
    const serverClient = new QueryClient()
    const browserClient = new QueryClient()
    const key = ['profile', 'prepared'] as const
    serverClient.setQueryData(key, serverProfile)
    let published: string | undefined
    const encoding = Effect.runPromise(
      prepareProfileSnapshot(serverClient).pipe(
        Effect.provideService(HydrationPreparation, preparation),
      ),
    ).then((json) => {
      published = json
      return json
    })
    yield* Deferred.await(encodingStarted)
    equal(published, undefined)
    equal(serverClient.getQueryData(key), serverProfile)
    yield* Deferred.succeed(encodingAllowed, undefined)
    const json = yield* Effect.promise(() => encoding)
    equal(JSON.parse(json).queries[0].state.data.credits, '9007199254740993')
    const decoding = Effect.runPromise(
      prepareProfileHydration(browserClient, json).pipe(
        Effect.provideService(HydrationPreparation, preparation),
      ),
    )
    yield* Deferred.await(decodingStarted)
    equal(browserClient.getQueryData(key), undefined)
    yield* Deferred.succeed(decodingAllowed, undefined)
    yield* Effect.promise(() => decoding)
    const hydrated = browserClient.getQueryData<Profile>(key)
    ok(hydrated instanceof Profile)
    equal(hydrated.summary(), 'Ada: 9007199254740993 credits')
    equal(hydrated.credits, 9007199254740993n)
    deepStrictEqual(hydrated.avatar, new Uint8Array([0, 1, 255]))
    const invalid = JSON.parse(json)
    invalid.queries.push({
      ...invalid.queries[0],
      queryHash: 'invalid',
      queryKey: ['profile', 'invalid'],
      state: {
        ...invalid.queries[0].state,
        data: { name: 'invalid', credits: 'oops', avatar: 'AAH/' },
      },
    })
    const untouched = new QueryClient()
    yield* Effect.promise(() =>
      rejects(
        Effect.runPromise(
          prepareProfileHydration(untouched, JSON.stringify(invalid)).pipe(
            Effect.provideService(HydrationPreparation, {
              beforeEncode: Effect.void,
              beforeDecode: Effect.void,
            }),
          ),
        ),
      ),
    )
    equal(untouched.getQueryCache().getAll().length, 0)
    untouched.clear()
    serverClient.clear()
    browserClient.clear()
  }),
)
