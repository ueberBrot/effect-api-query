/* oxlint-disable vitest/no-standalone-expect */
import { it } from '@effect/vitest'
import {
  experimental_streamedQuery,
  hashKey,
  QueryClient,
  QueryObserver,
} from '@tanstack/query-core'
import type { QueryFunction, QueryKey } from '@tanstack/query-core'
import { Effect, Predicate, Schema, Stream } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api'
import { Rpc, RpcGroup } from 'effect/rpc'
import { expect } from 'vite-plus/test'

import { createHttpApiQueryUtils, createRpcQueryUtils } from '#effect-api-query'

import { makeRpcTestClient } from './fixtures/effect-rpc.ts'

const cases = (['global', 'prefix'] as const).flatMap((hashing) =>
  (['native', 'custom'] as const).flatMap((initialHash) =>
    (['earlier', 'later'] as const).flatMap((order) =>
      (['reset', 'append', 'replace', 'live'] as const).map((view) => ({
        hashing,
        initialHash,
        order,
        view,
      })),
    ),
  ),
)

const verifyHashGuard = Effect.fnUntraced(function* <Data>(
  options: { readonly queryKey: QueryKey; readonly queryFn: QueryFunction<Data> },
  historicalData: Data,
  currentData: Data,
  expectedData: Data,
  hashing: 'global' | 'prefix',
  initialHash: 'native' | 'custom',
  order: 'earlier' | 'later',
  identity: Readonly<Record<string, string>>,
  executions: () => number,
) {
  const initialDefaults = {
    retry: false as const,
    ...(initialHash === 'custom'
      ? { queryKeyHashFn: (key: QueryKey) => `old:${JSON.stringify(key)}` }
      : undefined),
  }
  const defaults = {
    retry: false as const,
    queryKeyHashFn: (key: QueryKey) => `new:${JSON.stringify(key)}`,
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: initialDefaults },
  })
  if (order === 'later') {
    queryClient.setDefaultOptions({ queries: defaults })
    queryClient.setQueryData(options.queryKey, currentData)
    queryClient.setDefaultOptions({ queries: initialDefaults })
  }
  queryClient.setQueryData(options.queryKey, historicalData)
  const observer = new QueryObserver(queryClient, { ...options, enabled: false })
  const unsubscribe = observer.subscribe(() => {})
  const historical = observer.getCurrentQuery()
  const historicalState = { ...historical.state }
  if (hashing === 'global') {
    queryClient.setDefaultOptions({ queries: defaults })
  } else {
    queryClient.setQueryDefaults(options.queryKey, defaults)
  }
  try {
    yield* Effect.promise(async () => {
      await expect(queryClient.query(options)).rejects.toMatchObject({
        ...identity,
        code: 'UnsupportedQueryHash',
      })
    })
    expect(historical.state).toStrictEqual(historicalState)
    expect(executions()).toBe(0)
    queryClient.setQueryData(options.queryKey, currentData)
    const current = queryClient.getQueryCache().get(defaults.queryKeyHashFn(options.queryKey))
    const currentState = { ...current?.state }
    yield* Effect.promise(async () => {
      await expect(observer.refetch({ throwOnError: true })).rejects.toMatchObject({
        ...identity,
        code: 'UnsupportedQueryHash',
      })
    })
    expect(current?.state).toStrictEqual(currentState)
    expect(historical.state).toMatchObject({ data: historicalData, fetchStatus: 'idle' })
    expect(executions()).toBe(0)
    unsubscribe()
    queryClient.getQueryCache().remove(historical)
    expect(yield* Effect.promise(async () => await queryClient.query(options))).toStrictEqual(
      expectedData,
    )
    expect(executions()).toBe(1)
  } finally {
    unsubscribe()
    yield* Effect.promise(async () => {
      await queryClient.cancelQueries()
    })
    queryClient.clear()
  }
})

it.effect.each(cases)(
  'rejects $initialHash to $hashing hash changes with $order history in RPC $view streams',
  ({ hashing, initialHash, order, view }) =>
    Effect.gen(function* () {
      const group = RpcGroup.make(Rpc.make('watch', { success: Schema.Int, stream: true }))
      let executions = 0
      const client = yield* makeRpcTestClient(group, {
        watch: () => {
          executions += 1
          return Stream.succeed(2)
        },
      })
      const rpc = createRpcQueryUtils(group, { client, keyPrefix: ['stream-hashing'] })
      const identity = { _tag: 'EffectRpcQueryConfigError', rpcTag: 'watch' }
      const verification =
        view === 'live'
          ? verifyHashGuard(
              rpc.watch.liveOptions(),
              1,
              3,
              2,
              hashing,
              initialHash,
              order,
              identity,
              () => executions,
            )
          : verifyHashGuard(
              rpc.watch.streamedOptions({ refetchMode: view }),
              [1],
              [3],
              view === 'append' ? [3, 2] : [2],
              hashing,
              initialHash,
              order,
              identity,
              () => executions,
            )
      yield* verification
    }),
)

const foreignCases = (['rpc', 'http'] as const).flatMap((adapter) =>
  (['family', 'constant', 'bigint', 'cycle'] as const).flatMap((foreign) =>
    (['reset', 'append', 'replace', 'live'] as const).map((view) => ({ adapter, foreign, view })),
  ),
)

interface ForeignCycle {
  self?: ForeignCycle
}

const nativeStreamFn = () => Stream.toAsyncIterable(Stream.succeed(2))

const verifyForeignHash = Effect.fnUntraced(function* <Data>(
  options: { readonly queryKey: QueryKey; readonly queryFn: QueryFunction<Data> },
  nativeQueryFn: QueryFunction<Data>,
  initialData: Data,
  expectedData: Data,
  foreign: 'family' | 'constant' | 'bigint' | 'cycle',
) {
  const results: Data[] = []
  for (const queryFn of [options.queryFn, nativeQueryFn]) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(options.queryKey, initialData)
    queryClient.setQueryDefaults(['foreign'], {
      queryKeyHashFn: (key) => {
        if (foreign !== 'family') {
          return 'foreign:constant'
        }
        const [, input] = key
        if (!Predicate.isObject(input) || !Predicate.isNumber(input['id'])) {
          throw new TypeError('Foreign keys require an id')
        }
        return `foreign:${input['id']}`
      },
    })
    const cycle: ForeignCycle = {}
    cycle.self = cycle
    const objectInput = foreign === 'cycle' ? cycle : { id: 1 }
    const foreignKey = ['foreign', foreign === 'bigint' ? 1n : objectInput]
    queryClient.setQueryData(foreignKey, 'foreign data')
    const foreignQuery = queryClient
      .getQueryCache()
      .get(foreign === 'family' ? 'foreign:1' : 'foreign:constant')
    const foreignState = { ...foreignQuery?.state }
    try {
      const result = yield* Effect.promise(
        async () => await queryClient.query({ ...options, queryFn }),
      )
      results.push(result)
      expect(result).toStrictEqual(expectedData)
      expect(foreignQuery?.state).toStrictEqual(foreignState)
    } finally {
      queryClient.clear()
    }
  }
  expect(results[0]).toStrictEqual(results[1])
})

it.effect.each(foreignCases)(
  'preserves native $adapter $view behavior with a later $foreign foreign hasher',
  ({ adapter, foreign, view }) =>
    Effect.gen(function* () {
      const group = RpcGroup.make(Rpc.make('watch', { success: Schema.Int, stream: true }))
      const rpcClient = yield* makeRpcTestClient(group, { watch: () => Stream.succeed(2) })
      const rpc = createRpcQueryUtils(group, { client: rpcClient, keyPrefix: ['stream-hashing'] })
      const api = HttpApi.make('stream-hashing').add(
        HttpApiGroup.make('events').add(
          HttpApiEndpoint.get('watch', '/watch', {
            success: HttpApiSchema.StreamSse({ data: Schema.Int }),
          }),
        ),
      )
      const httpClient = yield* HttpApiClient.makeWith(api, {
        baseUrl: 'https://example.test',
        httpClient: HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response('data: 2\n\n', { headers: { 'content-type': 'text/event-stream' } }),
            ),
          ),
        ),
      })
      const http = createHttpApiQueryUtils(api, {
        client: httpClient,
        keyPrefix: ['stream-hashing'],
      })
      const verification =
        view === 'live'
          ? verifyForeignHash(
              adapter === 'rpc' ? rpc.watch.liveOptions() : http.events.watch.liveOptions(),
              experimental_streamedQuery({
                initialValue: 0,
                reducer: (_previous, value: number) => value,
                streamFn: nativeStreamFn,
              }),
              1,
              2,
              foreign,
            )
          : verifyForeignHash(
              adapter === 'rpc'
                ? rpc.watch.streamedOptions({ refetchMode: view })
                : http.events.watch.streamedOptions({ refetchMode: view }),
              experimental_streamedQuery({ refetchMode: view, streamFn: nativeStreamFn }),
              [1],
              view === 'append' ? [1, 2] : [2],
              foreign,
            )
      yield* verification
    }),
)

it.effect.each(cases)(
  'rejects $initialHash to $hashing hash changes with $order history in HTTP $view streams',
  ({ hashing, initialHash, order, view }) =>
    Effect.gen(function* () {
      const api = HttpApi.make('stream-hashing').add(
        HttpApiGroup.make('events').add(
          HttpApiEndpoint.get('watch', '/watch', {
            success: HttpApiSchema.StreamSse({ data: Schema.Int }),
          }),
        ),
      )
      let executions = 0
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: 'https://example.test',
        httpClient: HttpClient.make((request) => {
          executions += 1
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response('data: 2\n\n', { headers: { 'content-type': 'text/event-stream' } }),
            ),
          )
        }),
      })
      const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['stream-hashing'] })
      const identity = {
        _tag: 'EffectHttpApiQueryConfigError',
        apiId: 'stream-hashing',
        groupId: 'events',
        endpoint: 'watch',
        method: 'GET',
      }
      const verification =
        view === 'live'
          ? verifyHashGuard(
              http.events.watch.liveOptions(),
              1,
              3,
              2,
              hashing,
              initialHash,
              order,
              identity,
              () => executions,
            )
          : verifyHashGuard(
              http.events.watch.streamedOptions({ refetchMode: view }),
              [1],
              [3],
              view === 'append' ? [3, 2] : [2],
              hashing,
              initialHash,
              order,
              identity,
              () => executions,
            )
      yield* verification
    }),
)

const defaultHashCases = (['rpc', 'http'] as const).flatMap((adapter) =>
  (['global', 'prefix'] as const).flatMap((hashing) =>
    (['native', 'custom'] as const).flatMap((effectiveHash) =>
      (['matching', 'mismatched'] as const).flatMap((consistency) =>
        (['reset', 'append', 'replace', 'live'] as const).map((view) => ({
          adapter,
          hashing,
          effectiveHash,
          consistency,
          view,
        })),
      ),
    ),
  ),
)

const customDefaultHash = (key: QueryKey) => `stream:${hashKey(key)}`

const verifyDefaultHash = Effect.fnUntraced(function* <Data>(
  options: { readonly queryKey: QueryKey; readonly queryFn: QueryFunction<Data> },
  initialData: Data,
  expectedData: Data,
  hashing: 'global' | 'prefix',
  effectiveHash: 'native' | 'custom',
  consistency: 'matching' | 'mismatched',
  identity: Readonly<Record<string, string>>,
  executions: () => number,
) {
  const queryKeyHashFn = effectiveHash === 'custom' ? customDefaultHash : hashKey
  const queryHash = consistency === 'matching' ? queryKeyHashFn(options.queryKey) : 'only-watch'
  const defaults = {
    queryHash,
    ...(effectiveHash === 'custom' ? { queryKeyHashFn } : undefined),
  }
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, ...(hashing === 'global' ? defaults : undefined) },
    },
  })
  if (hashing === 'prefix') {
    queryClient.setQueryDefaults(options.queryKey, defaults)
  }
  queryClient.setQueryData(options.queryKey, initialData)
  const cached = queryClient.getQueryCache().get(queryHash)
  const initialUpdatedAt = cached?.state.dataUpdatedAt
  try {
    if (consistency === 'mismatched') {
      yield* Effect.promise(async () => {
        await expect(queryClient.query(options)).rejects.toMatchObject({
          ...identity,
          code: 'UnsupportedQueryHash',
        })
      })
      expect(cached?.state.data).toStrictEqual(initialData)
      expect(cached?.state.dataUpdatedAt).toBe(initialUpdatedAt)
      expect(executions()).toBe(0)
    } else {
      expect(yield* Effect.promise(async () => await queryClient.query(options))).toStrictEqual(
        expectedData,
      )
      expect(cached?.state.data).toStrictEqual(expectedData)
      expect(executions()).toBe(1)
    }
  } finally {
    queryClient.clear()
  }
})

it.effect.each(defaultHashCases)(
  'handles $consistency $hashing default queryHash with $effectiveHash hashing in $adapter $view streams',
  ({ adapter, hashing, effectiveHash, consistency, view }) =>
    Effect.gen(function* () {
      const group = RpcGroup.make(Rpc.make('watch', { success: Schema.Int, stream: true }))
      let executions = 0
      const rpcClient = yield* makeRpcTestClient(group, {
        watch: () => {
          executions += 1
          return Stream.succeed(2)
        },
      })
      const rpc = createRpcQueryUtils(group, { client: rpcClient, keyPrefix: ['stream-hashing'] })
      const api = HttpApi.make('stream-hashing').add(
        HttpApiGroup.make('events').add(
          HttpApiEndpoint.get('watch', '/watch', {
            success: HttpApiSchema.StreamSse({ data: Schema.Int }),
          }),
        ),
      )
      const httpClient = yield* HttpApiClient.makeWith(api, {
        baseUrl: 'https://example.test',
        httpClient: HttpClient.make((request) => {
          executions += 1
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response('data: 2\n\n', { headers: { 'content-type': 'text/event-stream' } }),
            ),
          )
        }),
      })
      const http = createHttpApiQueryUtils(api, {
        client: httpClient,
        keyPrefix: ['stream-hashing'],
      })
      const identity =
        adapter === 'rpc'
          ? { _tag: 'EffectRpcQueryConfigError', rpcTag: 'watch' }
          : {
              _tag: 'EffectHttpApiQueryConfigError',
              apiId: 'stream-hashing',
              groupId: 'events',
              endpoint: 'watch',
              method: 'GET',
            }
      const verification =
        view === 'live'
          ? verifyDefaultHash(
              adapter === 'rpc' ? rpc.watch.liveOptions() : http.events.watch.liveOptions(),
              1,
              2,
              hashing,
              effectiveHash,
              consistency,
              identity,
              () => executions,
            )
          : verifyDefaultHash(
              adapter === 'rpc'
                ? rpc.watch.streamedOptions({ refetchMode: view })
                : http.events.watch.streamedOptions({ refetchMode: view }),
              [1],
              view === 'append' ? [1, 2] : [2],
              hashing,
              effectiveHash,
              consistency,
              identity,
              () => executions,
            )
      yield* verification
    }),
)
