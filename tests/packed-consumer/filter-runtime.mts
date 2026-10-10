import { QueryClient } from '@tanstack/query-core'
import type { QueryFilters, QueryKey } from '@tanstack/query-core'
import { Effect, Layer, Stream } from 'effect'
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  EffectRpcQueryKeyError,
} from 'effect-api-query'
import { HttpServer } from 'effect/http'
import { HttpApiBuilder, HttpApiTest } from 'effect/http-api'
import { RpcTest } from 'effect/rpc'
import { deepStrictEqual, equal, throws } from 'node:assert/strict'

import { httpCacheFilters, usersApi } from './docs-cache-filters-http.ts'
import { userCacheFilters, usersRpc } from './docs-cache-filters-rpc.ts'

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(usersRpc, { flatten: true }).pipe(
        Effect.provide(
          usersRpc.toLayer({
            'users.get': ({ id, locale }) => Effect.succeed({ id, name: locale }),
            'users.watch': ({ id, locale }) => Stream.succeed({ id, name: locale }),
            'users.list': () => Effect.succeed([]),
            'health.ping': () => Effect.succeed('ok'),
          }),
        ),
      )
      const filters = userCacheFilters(client)
      const queryClient = new QueryClient()
      try {
        for (const input of [{ id: 1 }, { id: 1, locale: 'de' }, { id: 2 }]) {
          yield* Effect.promise(() =>
            queryClient.query(filters.rpc.users.get.queryOptions({ input })),
          )
        }
        equal(queryClient.getQueriesData(filters.forId(1)).length, 2)
        deepStrictEqual(queryClient.getQueryData(filters.exact(1).queryKey), {
          id: 1,
          name: 'en',
        })
        deepStrictEqual(
          filters.rpc.users.get.queryKey({ id: 1 }),
          filters.rpc.users.get.queryKey({ id: 1, locale: 'en' }),
        )
        equal(
          queryClient.getQueriesData({
            queryKey: [...filters.query.queryKey, { id: 1 }],
          }).length,
          0,
        )
        equal(
          queryClient.getQueriesData({ queryKey: filters.rpc.users.get.queryKey({ id: 1 }) })
            .length,
          1,
        )
        throws(
          () => Reflect.apply(filters.rpc.users.get.queryKey, undefined, [{ locale: 'en' }]),
          EffectRpcQueryKeyError,
        )
        equal(
          queryClient.getQueriesData({ ...filters.forId(1), type: 'inactive', stale: false })
            .length,
          2,
        )

        const infinite = filters.rpc.users.get.infiniteKey({ id: 1 })
        queryClient.setQueryData(infinite, {
          pages: [{ id: 1, name: 'page' }],
          pageParams: [0],
        })
        const histories = []
        for (const refetchMode of ['reset', 'append', 'replace'] as const) {
          for (const maxChunks of [undefined, 2]) {
            const key = filters.rpc.users.watch.streamedKey({ id: 1 }, { maxChunks, refetchMode })
            queryClient.setQueryData(key, [{ id: 1, name: refetchMode }])
            histories.push(key)
          }
        }
        const otherHistory = filters.rpc.users.watch.streamedKey({ id: 2 }, { maxChunks: 2 })
        queryClient.setQueryData(otherHistory, [{ id: 2, name: 'other' }])
        const live = filters.rpc.users.watch.liveKey({ id: 1 })
        queryClient.setQueryData(live, { id: 1, name: 'live' })
        const list = filters.rpc.users.list.queryKey()
        queryClient.setQueryData(list, [])
        const ping = filters.rpc.health.ping.queryKey()
        queryClient.setQueryData(ping, 'ok')
        queryClient.setQueryData(['unrelated'], 'other')

        const snapshots = queryClient.getQueriesData({})
        const unaryKeys = [
          filters.rpc.users.get.queryKey({ id: 1 }),
          filters.rpc.users.get.queryKey({ id: 1, locale: 'de' }),
          filters.rpc.users.get.queryKey({ id: 2 }),
        ]
        const userKeys = [...unaryKeys, infinite, ...histories, otherHistory, live, list]
        const cases: readonly [QueryFilters, readonly QueryKey[]][] = [
          [filters.root, [...userKeys, ping]],
          [filters.branch, userKeys],
          [filters.leaf, [...unaryKeys, infinite]],
          [filters.query, unaryKeys],
          [filters.forId(1), unaryKeys.slice(0, 2)],
          [filters.exact(1), [filters.exact(1).queryKey]],
          [filters.history, [...histories, otherHistory]],
          [filters.historyForId(1), histories],
          [
            {
              queryKey: filters.rpc.users.watch.streamedKey({ id: 1 }, { maxChunks: 2 }),
              exact: true,
            },
            [filters.rpc.users.watch.streamedKey({ id: 1 }, { maxChunks: 2 })],
          ],
          [
            {
              queryKey: filters.rpc.users.watch.streamedKey(
                { id: 1 },
                { maxChunks: undefined, refetchMode: 'reset' },
              ),
              exact: true,
            },
            [filters.rpc.users.watch.streamedKey({ id: 1 })],
          ],
        ]
        for (const [filter, expectedKeys] of cases) {
          const owner = new QueryClient()
          try {
            for (const [key, data] of snapshots) owner.setQueryData(key, data)
            deepStrictEqual(
              owner.getQueriesData(filter).map(([key]) => key),
              expectedKeys,
            )
            yield* Effect.promise(() => owner.invalidateQueries(filter))
            deepStrictEqual(
              snapshots.map(([key]) => owner.getQueryState(key)?.isInvalidated),
              snapshots.map(([key]) =>
                expectedKeys.some((expected) => JSON.stringify(expected) === JSON.stringify(key)),
              ),
            )
          } finally {
            owner.clear()
          }
        }

        const projected = createRpcQueryUtils(usersRpc, {
          client,
          keyPrefix: ['projected'],
          keyEncoders: {
            'users.get': ({ id, locale }) => ({
              entity: { identifier: String(id) },
              language: locale,
            }),
          },
        })
        const scalar = createRpcQueryUtils(usersRpc, {
          client,
          keyPrefix: ['scalar'],
          keyEncoders: { 'users.get': ({ id, locale }) => `${id}:${locale}` },
        })
        for (const input of [{ id: 1 }, { id: 1, locale: 'de' }, { id: 2 }]) {
          queryClient.setQueryData(projected.users.get.queryKey(input), {
            id: input.id,
            name: 'custom',
          })
          queryClient.setQueryData(scalar.users.get.queryKey(input), {
            id: input.id,
            name: 'scalar',
          })
        }
        equal(
          queryClient.getQueriesData({
            queryKey: [...projected.users.get.key(), 'query', { id: '1' }],
          }).length,
          0,
        )
        equal(
          queryClient.getQueriesData({
            queryKey: [...projected.users.get.key(), 'query', { entity: { identifier: '1' } }],
          }).length,
          2,
        )
        equal(queryClient.getQueriesData({ queryKey: scalar.users.get.key() }).length, 3)
        equal(
          queryClient.getQueriesData({ queryKey: [...scalar.users.get.key(), 'query', '1'] })
            .length,
          0,
        )
        equal(
          queryClient.getQueriesData({
            queryKey: scalar.users.get.queryKey({ id: 1 }),
            exact: true,
          }).length,
          1,
        )
        deepStrictEqual(queryClient.getQueryData(projected.users.get.queryKey({ id: 1 })), {
          id: 1,
          name: 'custom',
        })
      } finally {
        queryClient.clear()
      }
    }),
  ),
)

console.log(
  'Packed RPC native prefixes, encoded partial filters, exact keys and stream policies verified',
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const handlers = HttpApiBuilder.group(usersApi, 'users', (group) =>
        group
          .handle('get', ({ params, query, payload, headers }) =>
            Effect.succeed(`${params.id}:${query.id}:${payload.id}:${headers['x-locale']}`),
          )
          .handle('watch', ({ query }) => Effect.succeed(Stream.succeed(String(query.id)))),
      )
      const system = HttpApiBuilder.group(usersApi, 'system', (group) =>
        group.handle('ping', () => Effect.succeed('ok')),
      )
      const client = yield* HttpApiTest.groups(usersApi, ['users', 'system']).pipe(
        Effect.provide(Layer.mergeAll(handlers, system, HttpServer.layerServices)),
      )
      const filters = httpCacheFilters(client)
      const queryClient = new QueryClient()
      const input = {
        params: { id: 1 },
        query: { id: 7, filter: undefined },
        headers: { 'X-Locale': 'en', ignored: undefined },
        payload: { id: 9 },
      }
      const germanInput = { ...input, headers: { 'x-locale': 'de' } }
      const otherInput = { ...input, params: { id: 2 } }
      const swappedInput = { ...input, query: { id: 9, filter: undefined }, payload: { id: 7 } }
      const inputs = [input, germanInput, otherInput, swappedInput]
      try {
        for (const request of inputs) {
          yield* Effect.promise(() =>
            queryClient.query(filters.http.users.get.queryOptions({ input: request })),
          )
        }
        deepStrictEqual(queryClient.getQueryData(filters.exact(input).queryKey), '1:7:9:en')
        deepStrictEqual(
          filters.exact(input).queryKey,
          filters.exact({ ...input, query: { id: 7 }, headers: { 'x-locale': 'en' } }).queryKey,
        )
        equal(queryClient.getQueriesData(filters.forId(1)).length, 3)
        equal(queryClient.getQueriesData(filters.forLocale('en')).length, 3)
        for (const partial of [{ params: { id: 1 } }, { headers: { 'X-Locale': 'en' } }]) {
          equal(
            queryClient.getQueriesData({ queryKey: [...filters.query.queryKey, partial] }).length,
            0,
          )
        }
        for (const [partial, count] of [
          [{ query: { id: '7' } }, 3],
          [{ payload: { id: '7' } }, 1],
          [{ id: '7' }, 0],
        ] as const) {
          equal(
            queryClient.getQueriesData({ queryKey: [...filters.query.queryKey, partial] }).length,
            count,
          )
        }
        const metadata = filters.http.users.get.metadataKey(input)
        queryClient.setQueryData(metadata, { data: 'metadata', status: 200, headers: {} })
        const infinite = filters.http.users.get.infiniteKey(input)
        queryClient.setQueryData(infinite, { pages: ['page'], pageParams: [0] })
        const histories = []
        for (const refetchMode of ['reset', 'append', 'replace'] as const) {
          for (const maxChunks of [undefined, 2]) {
            const key = filters.http.users.watch.streamedKey(
              { query: { id: 1 } },
              { maxChunks, refetchMode },
            )
            queryClient.setQueryData(key, ['history'])
            histories.push(key)
          }
        }
        const otherHistory = filters.http.users.watch.streamedKey({ query: { id: 2 } })
        queryClient.setQueryData(otherHistory, ['other'])
        const live = filters.http.users.watch.liveKey({ query: { id: 1 } })
        queryClient.setQueryData(live, 'live')
        const ping = filters.http.ping.queryKey()
        queryClient.setQueryData(ping, 'ok')
        queryClient.setQueryData(['unrelated'], 'other')
        const snapshots = queryClient.getQueriesData({})
        const unaryKeys = inputs.map((request) => filters.exact(request).queryKey)
        const userKeys = [...unaryKeys, metadata, infinite, ...histories, otherHistory, live]
        const bounded = filters.http.users.watch.streamedKey({ query: { id: 1 } }, { maxChunks: 2 })
        const cases: readonly [QueryFilters, readonly QueryKey[]][] = [
          [filters.root, [...userKeys, ping]],
          [filters.branch, userKeys],
          [filters.leaf, [...unaryKeys, metadata, infinite]],
          [filters.query, unaryKeys],
          [
            filters.forId(1),
            [input, germanInput, swappedInput].map((request) => filters.exact(request).queryKey),
          ],
          [filters.exact(input), [filters.exact(input).queryKey]],
          [filters.historyForId(1), histories],
          [
            { queryKey: [...filters.http.users.watch.key(), 'streamed'] },
            [...histories, otherHistory],
          ],
          [{ queryKey: bounded, exact: true }, [bounded]],
        ]
        for (const [filter, expectedKeys] of cases) {
          const owner = new QueryClient()
          try {
            for (const [key, data] of snapshots) owner.setQueryData(key, data)
            deepStrictEqual(
              owner.getQueriesData(filter).map(([key]) => key),
              expectedKeys,
            )
            yield* Effect.promise(() => owner.invalidateQueries(filter))
            deepStrictEqual(
              snapshots.map(([key]) => owner.getQueryState(key)?.isInvalidated),
              snapshots.map(([key]) =>
                expectedKeys.some((expected) => JSON.stringify(expected) === JSON.stringify(key)),
              ),
            )
          } finally {
            owner.clear()
          }
        }

        const projected = createHttpApiQueryUtils(usersApi, {
          client,
          keyPrefix: ['http-project'],
          keyEncoders: {
            users: {
              get: ({ params, query, payload, headers }) => ({
                routeId: params.id,
                queryId: query.id,
                bodyId: payload.id,
                language: headers['X-Locale'] ?? headers['x-locale'] ?? null,
              }),
            },
          },
        })
        for (const request of inputs) {
          queryClient.setQueryData(projected.users.get.queryKey(request), 'projected')
        }
        equal(
          queryClient.getQueriesData({
            queryKey: [...projected.users.get.key(), 'query', { params: { id: '1' } }],
          }).length,
          0,
        )
        equal(
          queryClient.getQueriesData({
            queryKey: [...projected.users.get.key(), 'query', { routeId: 1 }],
          }).length,
          3,
        )
        equal(
          queryClient.getQueriesData({ queryKey: projected.users.get.queryKey(input), exact: true })
            .length,
          1,
        )
      } finally {
        queryClient.clear()
      }
    }),
  ),
)

console.log(
  'Packed HTTP native filters, request labels, header normalization and policies verified',
)
