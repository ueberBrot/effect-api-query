import { QueryClient, QueryObserver } from '@tanstack/query-core'
import type {
  InfiniteData,
  InfiniteQueryObserverOptions,
  QueryKey,
  QueryObserverOptions,
} from '@tanstack/query-core'
import { Effect, Layer, Schema, Stream } from 'effect'
import {
  EffectHttpApiQueryConfigError,
  EffectRpcQueryConfigError,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  skipToken,
} from 'effect-api-query'
import { HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiTest,
} from 'effect/http-api'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'
import { deepStrictEqual, equal, ok, throws } from 'node:assert/strict'

const group = RpcGroup.make(
  Rpc.make('read', { payload: { id: Schema.Int }, success: Schema.String }),
  Rpc.make('page', { payload: { cursor: Schema.Int }, success: Schema.Int }),
  Rpc.make('watch', { payload: { id: Schema.Int }, success: Schema.String, stream: true }),
)
const api = HttpApi.make('hashing-api').add(
  HttpApiGroup.make('items').add(
    HttpApiEndpoint.get('read', '/items/:id', {
      params: { id: Schema.FiniteFromString },
      success: Schema.String,
    }),
    HttpApiEndpoint.get('page', '/pages', {
      query: { cursor: Schema.FiniteFromString },
      success: Schema.Int,
    }),
  ),
)
const httpHandlers = HttpApiBuilder.group(api, 'items', (handlers) =>
  handlers
    .handle('read', ({ params }) => Effect.succeed(`http:${params.id}`))
    .handle('page', ({ query }) => Effect.succeed(query.cursor)),
)

const assertInfinitePages = async <Error, Key extends QueryKey>(
  queryClient: QueryClient,
  options: InfiniteQueryObserverOptions<number, Error, InfiniteData<number, number>, Key, number>,
) => {
  deepStrictEqual(await queryClient.infiniteQuery({ ...options, pages: 2 }), {
    pages: [0, 1],
    pageParams: [0, 1],
  })
  deepStrictEqual(queryClient.getQueryData(options.queryKey), {
    pages: [0, 1],
    pageParams: [0, 1],
  })
  queryClient.setQueryData<InfiniteData<number, number>>(options.queryKey, {
    pages: [7],
    pageParams: [0],
  })
  deepStrictEqual(await queryClient.infiniteQuery(options), {
    pages: [7],
    pageParams: [0],
  })
  ok(Object.isFrozen(options.queryKey))
}

const assertStreamSnapshot = async <Data, Error, Key extends QueryKey>(
  queryClient: QueryClient,
  options: QueryObserverOptions<Data, Error, Data, Data, Key>,
  expected: Data,
  updated: Data,
) => {
  const observer = new QueryObserver(queryClient, options)
  let unsubscribe = () => {}
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const first = await new Promise<{ readonly data: Data; readonly fetchStatus: string }>(
      (resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('First emission timed out')), 10_000)
        unsubscribe = observer.subscribe((result) => {
          if (result.status === 'success') resolve(result)
          else if (result.status === 'error') reject(result.error)
        })
      },
    )
    deepStrictEqual(first.data, expected)
    equal(first.fetchStatus, 'fetching')
    deepStrictEqual(queryClient.getQueryData(options.queryKey), expected)
    queryClient.setQueryData<Data>(options.queryKey, updated)
    deepStrictEqual(observer.getCurrentResult().data, updated)
    deepStrictEqual(queryClient.getQueryData(options.queryKey), updated)
    equal(
      queryClient.getQueryCache().findAll({ queryKey: options.queryKey, exact: true }).length,
      1,
    )
    ok(Object.isFrozen(options.queryKey))
  } finally {
    clearTimeout(timeout)
    await queryClient.cancelQueries({ queryKey: options.queryKey })
    unsubscribe()
    observer.destroy()
  }
}

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
        Effect.provide(
          group.toLayer({
            read: ({ id }) => Effect.succeed(`rpc:${id}`),
            page: ({ cursor }) => Effect.succeed(cursor),
            watch: () => Stream.succeed('first').pipe(Stream.concat(Stream.never)),
          }),
        ),
      )
      const utils = createRpcQueryUtils(group, { client, keyPrefix: ['hashing'] })
      const httpClient = yield* HttpApiTest.groups(api, ['items']).pipe(
        Effect.provide(Layer.mergeAll(httpHandlers, HttpServer.layerServices)),
      )
      const http = createHttpApiQueryUtils(api, { client: httpClient, keyPrefix: ['hashing'] })
      for (const [field, value] of [
        ['queryKeyHashFn', () => 'caller'],
        ['queryHash', 'caller'],
        ['queryKeyHashFn', undefined],
        ['queryHash', undefined],
      ] as const) {
        const rpcError = (error: unknown) => {
          ok(error instanceof EffectRpcQueryConfigError)
          equal(error.code, 'UnsupportedQueryHash')
          ok(error.rpcTag === 'read' || error.rpcTag === 'page' || error.rpcTag === 'watch')
          return true
        }
        const httpError = (error: unknown) => {
          ok(error instanceof EffectHttpApiQueryConfigError)
          equal(error.code, 'UnsupportedQueryHash')
          equal(error.apiId, 'hashing-api')
          equal(error.groupId, 'items')
          ok(error.endpoint === 'read' || error.endpoint === 'page')
          return true
        }
        for (const input of [{ id: 1 }, skipToken] as const) {
          const argument = Object.freeze({ input, [field]: value })
          throws(() => utils.read.queryOptions(argument), rpcError)
          throws(() => utils.watch.liveOptions(argument), rpcError)
          throws(() => utils.watch.streamedOptions(argument), rpcError)
          ok(Object.hasOwn(argument, field))
        }
        for (const input of [{ params: { id: 1 } }, skipToken] as const) {
          throws(() => http.items.read.queryOptions({ input, [field]: value }), httpError)
        }
        throws(
          () =>
            utils.page.infiniteOptions({
              input: (cursor: number) => ({ cursor }),
              initialPageParam: 0,
              getNextPageParam: () => undefined,
              [field]: value,
            }),
          rpcError,
        )
        throws(
          () =>
            http.items.page.infiniteOptions({
              input: (cursor: number) => ({ query: { cursor } }),
              initialPageParam: 0,
              getNextPageParam: () => undefined,
              [field]: value,
            }),
          httpError,
        )
      }
      for (const mode of ['global', 'prefix'] as const) {
        const queryClient = new QueryClient({
          defaultOptions: {
            queries: {
              gcTime: Infinity,
              retry: false,
              staleTime: Infinity,
              queryKeyHashFn: (key) => `global:${JSON.stringify(key)}`,
            },
          },
        })
        if (mode === 'prefix') {
          queryClient.setQueryDefaults(utils.key(), {
            queryKeyHashFn: (key) => `prefix:${JSON.stringify(key)}`,
          })
          queryClient.setQueryDefaults(http.key(), {
            queryKeyHashFn: (key) => `prefix:${JSON.stringify(key)}`,
          })
        }
        try {
          const options = utils.read.queryOptions({ input: { id: 1 } })
          equal(yield* Effect.promise(() => queryClient.query(options)), 'rpc:1')
          equal(queryClient.getQueryData(utils.read.queryKey({ id: 1 })), 'rpc:1')
          queryClient.setQueryData(utils.read.queryKey({ id: 1 }), 'native')
          equal(queryClient.getQueryData(options.queryKey), 'native')
          equal(yield* Effect.promise(() => queryClient.query(options)), 'native')
          equal(queryClient.getQueryCache().getAll().length, 1)
          ok(Object.isFrozen(options.queryKey))
          ok(Object.isFrozen(options.queryKey.at(-1)))

          const httpOptions = http.items.read.queryOptions({ input: { params: { id: 1 } } })
          equal(yield* Effect.promise(() => queryClient.query(httpOptions)), 'http:1')
          equal(queryClient.getQueryData(http.items.read.queryKey({ params: { id: 1 } })), 'http:1')
          queryClient.setQueryData(http.items.read.queryKey({ params: { id: 1 } }), 'native-http')
          equal(queryClient.getQueryData(httpOptions.queryKey), 'native-http')
          equal(yield* Effect.promise(() => queryClient.query(httpOptions)), 'native-http')
          ok(Object.isFrozen(httpOptions.queryKey))
          ok(Object.isFrozen(httpOptions.queryKey.at(-1)))

          const pages = utils.page.infiniteOptions({
            input: (cursor) => ({ cursor }),
            initialPageParam: 0,
            getNextPageParam: (_last, _pages, cursor) => (cursor < 1 ? cursor + 1 : undefined),
          })
          const httpPages = http.items.page.infiniteOptions({
            input: (cursor) => ({ query: { cursor } }),
            initialPageParam: 0,
            getNextPageParam: (_last, _pages, cursor) => (cursor < 1 ? cursor + 1 : undefined),
          })
          yield* Effect.promise(() => assertInfinitePages(queryClient, pages))
          yield* Effect.promise(() => assertInfinitePages(queryClient, httpPages))

          yield* Effect.promise(() =>
            assertStreamSnapshot(
              queryClient,
              utils.watch.liveOptions({ input: { id: 1 } }),
              'first',
              'native-live',
            ),
          )
          yield* Effect.promise(() =>
            assertStreamSnapshot(
              queryClient,
              utils.watch.streamedOptions({ input: { id: 1 } }),
              ['first'],
              ['first', 'native-streamed'],
            ),
          )
          equal(queryClient.getQueryCache().getAll().length, 6)
          ok(
            queryClient
              .getQueryCache()
              .getAll()
              .every((query) => query.queryHash.startsWith(`${mode}:`)),
          )
        } finally {
          queryClient.clear()
        }
      }
    }),
  ),
)
