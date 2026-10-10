import { QueryClient, QueryObserver } from '@tanstack/query-core'
import { Effect, Layer } from 'effect'
import { isEffectRpcQueryError } from 'effect-api-query'
import { HttpServer, HttpServerResponse } from 'effect/http'
import { HttpApiBuilder, HttpApiTest } from 'effect/http-api'
import { RpcTest } from 'effect/rpc'
import { deepStrictEqual, equal, ok, rejects } from 'node:assert/strict'

import { createApplicationQueries, usersRpc } from './docs-defaults.ts'
import { createHttpApplicationQueries, usersApi } from './docs-http-defaults.ts'

await Effect.runPromise(
  Effect.gen(function* () {
    const attempts = new Map<number, number>()
    const client = yield* RpcTest.makeClient(usersRpc, { flatten: true }).pipe(
      Effect.provide(
        usersRpc.toLayer({
          'users.get': ({ id }) => {
            const attempt = (attempts.get(id) ?? 0) + 1
            attempts.set(id, attempt)
            return id === 2 || attempt < 3
              ? Effect.fail({ _tag: 'RetryLater' as const })
              : Effect.succeed({ id, name: 'Ada' })
          },
        }),
      ),
    )
    const { queryClient, rpc, user, refreshUser } = createApplicationQueries(client)
    const observer = new QueryObserver(queryClient, user)
    let unsubscribe: () => void = () => undefined
    try {
      equal(observer.options.staleTime, 120_000)
      equal(observer.options.gcTime, 600_000)
      equal(observer.options.retry, 2)
      unsubscribe = observer.subscribe(() => undefined)
      equal(yield* Effect.promise(() => queryClient.query(user)), 'Ada')
      equal(attempts.get(1), 3)
      equal(observer.getCurrentResult().data, 'Ada')
      equal(observer.getCurrentResult().isStale, false)
      deepStrictEqual(queryClient.getQueryData(rpc.users.get.queryKey({ id: 1 })), {
        id: 1,
        name: 'Ada',
      })
      queryClient.setQueryData(rpc.users.get.queryKey({ id: 1 }), { id: 1, name: 'Grace' })
      equal(observer.getCurrentResult().data, 'Grace')
      equal(yield* Effect.promise(() => queryClient.query(user)), 'Grace')
      equal(attempts.get(1), 3)
      deepStrictEqual(yield* Effect.promise(() => queryClient.query(refreshUser)), {
        id: 1,
        name: 'Ada',
      })
      equal(attempts.get(1), 4)
      const refreshObserver = new QueryObserver(queryClient, refreshUser)
      equal(refreshObserver.options.staleTime, 0)
      equal(refreshObserver.options.retry, false)
      refreshObserver.destroy()
      yield* Effect.promise(() =>
        rejects(
          queryClient.query(rpc.users.get.queryOptions({ input: { id: 2 }, retry: false })),
          (error: unknown) => isEffectRpcQueryError(error),
        ),
      )
      equal(attempts.get(2), 1)
      yield* Effect.promise(() =>
        rejects(
          queryClient.query(rpc.users.get.queryOptions({ input: { id: 2 }, retryDelay: 0 })),
          (error: unknown) => isEffectRpcQueryError(error),
        ),
      )
      equal(attempts.get(2), 4)
    } finally {
      unsubscribe()
      observer.destroy()
      queryClient.clear()
    }
    for (const mode of ['global', 'prefix'] as const) {
      let fallbackCalls = 0
      const hashClient = new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: Infinity,
            staleTime: Infinity,
            retry: false,
            queryKeyHashFn: (key) => `global:${JSON.stringify(key)}`,
          },
        },
      })
      hashClient.setQueryDefaults(rpc.key(), {
        queryFn: () => {
          fallbackCalls += 1
          return Promise.resolve({ id: -1, name: 'fallback' })
        },
      })
      if (mode === 'prefix')
        hashClient.setQueryDefaults(rpc.users.key(), {
          queryKeyHashFn: (key) => `prefix:${JSON.stringify(key)}`,
        })
      const options = rpc.users.get.queryOptions({ input: { id: 1 } })
      const selected = new QueryObserver(
        hashClient,
        rpc.users.get.queryOptions({ input: { id: 1 }, select: (value) => value.name }),
      )
      let stop: () => void = () => undefined
      try {
        deepStrictEqual(yield* Effect.promise(() => hashClient.query(options)), {
          id: 1,
          name: 'Ada',
        })
        const key = rpc.users.get.queryKey({ id: 1 })
        deepStrictEqual(hashClient.getQueryData(key), { id: 1, name: 'Ada' })
        stop = selected.subscribe(() => undefined)
        hashClient.setQueryData(key, { id: 1, name: 'native' })
        equal(selected.getCurrentResult().data, 'native')
        deepStrictEqual(yield* Effect.promise(() => hashClient.query(options)), {
          id: 1,
          name: 'native',
        })
        equal(fallbackCalls, 0)
        equal(hashClient.getQueryCache().getAll().length, 1)
        equal(
          hashClient.getQueryCache().getAll()[0]?.queryHash,
          `${mode}:["users-app","rpc","users","get","query",{"id":1}]`,
        )
        ok(Object.isFrozen(key))
      } finally {
        stop()
        selected.destroy()
        hashClient.clear()
      }
    }
  }).pipe(Effect.scoped),
)

let httpAttempts = 0
const httpHandlers = HttpApiBuilder.group(usersApi, 'users', (group) =>
  group.handleRaw('get', ({ params }) => {
    httpAttempts += 1
    return HttpServerResponse.json(
      httpAttempts === 1 ? { _tag: 'RetryLater' } : { id: params.id, name: 'Ada' },
      { status: httpAttempts === 1 ? 503 : 200, headers: { etag: '"v1"' } },
    ).pipe(Effect.orDie)
  }),
)
await Effect.runPromise(
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(usersApi, ['users'])
    const { queryClient, http, user, metadata } = createHttpApplicationQueries(client)
    const userObserver = new QueryObserver(queryClient, user)
    const metadataObserver = new QueryObserver(queryClient, metadata)
    let unsubscribe: () => void = () => undefined
    try {
      equal(userObserver.options.staleTime, 30_000)
      equal(userObserver.options.retry, 1)
      equal(metadataObserver.options.staleTime, 5_000)
      equal(metadataObserver.options.retry, 1)
      deepStrictEqual(yield* Effect.promise(() => queryClient.query(user)), {
        id: 1,
        name: 'Ada',
      })
      equal(httpAttempts, 2)
      const snapshot = yield* Effect.promise(() => queryClient.query(metadata))
      deepStrictEqual(snapshot.data, { id: 1, name: 'Ada' })
      equal(snapshot.status, 200)
      equal(snapshot.headers['etag'], '"v1"')
      equal(httpAttempts, 3)
      ok(Object.isFrozen(snapshot))
      ok(Object.isFrozen(snapshot.headers))
      equal(queryClient.getQueryData(http.users.get.metadataKey({ params: { id: 1 } })), snapshot)
      unsubscribe = userObserver.subscribe(() => undefined)
      queryClient.setQueryData(http.users.get.queryKey({ params: { id: 1 } }), {
        id: 1,
        name: 'Grace',
      })
      deepStrictEqual(userObserver.getCurrentResult().data, { id: 1, name: 'Grace' })
      deepStrictEqual(yield* Effect.promise(() => queryClient.query(user)), {
        id: 1,
        name: 'Grace',
      })
      equal(yield* Effect.promise(() => queryClient.query(metadata)), snapshot)
      equal(httpAttempts, 3)
      const fresh = http.users.get.queryOptions({
        input: { params: { id: 1 } },
        staleTime: 0,
        retry: false,
      })
      deepStrictEqual(yield* Effect.promise(() => queryClient.query(fresh)), {
        id: 1,
        name: 'Ada',
      })
      equal(httpAttempts, 4)
      equal(queryClient.getQueryCache().getAll().length, 2)
      deepStrictEqual(
        queryClient
          .getQueryCache()
          .getAll()
          .map((query) => query.queryHash),
        [
          'users:["users-app","http","users","users","get","query",{"params":{"id":"1"}}]',
          'users:["users-app","http","users","users","get","metadata",{"params":{"id":"1"}}]',
        ],
      )
    } finally {
      unsubscribe()
      userObserver.destroy()
      metadataObserver.destroy()
      queryClient.clear()
    }
  }).pipe(Effect.provide(Layer.mergeAll(httpHandlers, HttpServer.layerServices)), Effect.scoped),
)
console.log(
  'Packed RPC/HTTP defaults, precedence, observed values, retries and native hashing executed',
)
