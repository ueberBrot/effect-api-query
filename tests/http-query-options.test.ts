import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/query-core'
import { Cause, Effect, Exit, Layer, Schema, Scope } from 'effect'
import { HttpServer } from 'effect/unstable/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiTest,
} from 'effect/unstable/httpapi'
import { expect, it } from 'vite-plus/test'

import { createHttpApiQueryUtils, skipToken } from '#effect-api-query'

const Page = Schema.Struct({
  items: Schema.Array(Schema.String),
  next: Schema.NullOr(Schema.Finite),
})
const Api = HttpApi.make('pages').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('list', '/users', {
      query: { cursor: Schema.FiniteFromString, filter: Schema.String },
      success: Page,
      error: Schema.String,
    }),
  ),
)

it('maps HTTP page requests, partitions stable filters, and refetches through native invalidation', async () => {
  const requests: Array<{ cursor: number; filter: string }> = []
  const handlers = HttpApiBuilder.group(Api, 'users', (handlers) =>
    handlers.handle('list', ({ query }) => {
      requests.push(query)
      return Effect.succeed({
        items: [`${query.filter}:${query.cursor}`],
        next: query.cursor < 1 ? query.cursor + 1 : null,
      })
    }),
  )
  const scope = Scope.makeUnsafe()
  const client = await Effect.runPromise(
    HttpApiTest.groups(Api, ['users']).pipe(
      Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
      Effect.provideService(Scope.Scope, scope),
    ),
  )
  const utils = createHttpApiQueryUtils(Api, { client, keyPrefix: ['test'] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const options = utils.users.list.infiniteOptions({
    initialPageParam: 0,
    input: (cursor) => ({ query: { cursor, filter: 'active' } }),
    getNextPageParam: (lastPage) => lastPage.next,
    staleTime: Infinity,
    ...({ queryHash: 'collision' } as {}),
  })
  const observer = new InfiniteQueryObserver(queryClient, options)
  const unsubscribe = observer.subscribe(() => {})
  try {
    await observer.refetch()
    await observer.fetchNextPage()
    expect(observer.getCurrentResult().data).toEqual({
      pages: [
        { items: ['active:0'], next: 1 },
        { items: ['active:1'], next: null },
      ],
      pageParams: [0, 1],
    })
    expect(
      await queryClient.query(
        utils.users.list.queryOptions({
          input: { query: { cursor: 42, filter: 'active' } },
          staleTime: Infinity,
          ...({ queryHash: 'collision' } as {}),
        }),
      ),
    ).toEqual({ items: ['active:42'], next: null })
    expect(options.queryKey).toEqual([
      'test',
      'http',
      'pages',
      'users',
      'list',
      'infinite',
      { query: { cursor: '0', filter: 'active' } },
    ])
    expect(utils.users.list.infiniteKey({ query: { cursor: 0, filter: 'archived' } })).not.toEqual(
      options.queryKey,
    )
    expect(utils.users.list.queryKey({ query: { cursor: 0, filter: 'active' } })).not.toEqual(
      options.queryKey,
    )
    requests.length = 0
    await queryClient.invalidateQueries({ queryKey: utils.users.list.key() })
    expect(requests).toEqual([
      { cursor: 0, filter: 'active' },
      { cursor: 1, filter: 'active' },
    ])
  } finally {
    unsubscribe()
    queryClient.clear()
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

it.each(['declared', 'encoding'] as const)(
  'preserves cached HTTP pages after a later %s failure',
  async (failure) => {
    const handlers = HttpApiBuilder.group(Api, 'users', (handlers) =>
      handlers.handle('list', ({ query }) =>
        query.cursor === 0
          ? Effect.succeed({ items: ['first'], next: 1 })
          : Effect.fail('page unavailable'),
      ),
    )
    const scope = Scope.makeUnsafe()
    const client = await Effect.runPromise(
      HttpApiTest.groups(Api, ['users']).pipe(
        Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
        Effect.provideService(Scope.Scope, scope),
      ),
    )
    const utils = createHttpApiQueryUtils(Api, { client, keyPrefix: ['test'] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    try {
      const options = utils.users.list.infiniteOptions({
        initialPageParam: 0,
        input: (cursor) => ({
          query: {
            cursor: failure === 'encoding' && cursor === 1 ? Number.NaN : cursor,
            filter: 'active',
          },
        }),
        getNextPageParam: (page) => page.next,
      })
      await queryClient.infiniteQuery(options)
      const observer = new InfiniteQueryObserver(queryClient, options)
      const result = await observer.fetchNextPage()
      expect(result.error).toMatchObject({
        _tag: 'EffectHttpApiQueryError',
        operation: 'infinite',
        apiId: 'pages',
        groupId: 'users',
        endpoint: 'list',
        method: 'GET',
      })
      if (failure === 'declared') {
        expect(Cause.squash(result.error!.cause)).toBe('page unavailable')
      } else {
        expect(Cause.squash(result.error!.cause)).toMatchObject({ _tag: 'SchemaError' })
      }
      expect(result.data).toEqual({ pages: [{ items: ['first'], next: 1 }], pageParams: [0] })
    } finally {
      queryClient.clear()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  },
)

it('skips HTTP queries without encoding or execution and retains native options', async () => {
  let requests = 0
  let encodings = 0
  const handlers = HttpApiBuilder.group(Api, 'users', (handlers) =>
    handlers.handle('list', () => {
      requests += 1
      return Effect.succeed({ items: [], next: null })
    }),
  )
  const scope = Scope.makeUnsafe()
  const client = await Effect.runPromise(
    HttpApiTest.groups(Api, ['users']).pipe(
      Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
      Effect.provideService(Scope.Scope, scope),
    ),
  )
  const utils = createHttpApiQueryUtils(Api, {
    client,
    keyPrefix: ['test'],
    keyEncoders: {
      users: {
        list: (input) => {
          encodings += 1
          return input.query
        },
      },
    },
  })
  const queryClient = new QueryClient()
  const options = utils.users.list.queryOptions({
    input: skipToken,
    staleTime: 123,
    meta: { label: 'waiting' },
  })
  const infinite = utils.users.list.infiniteOptions({
    input: skipToken,
    initialPageParam: 0,
    getNextPageParam: (page) => page.next,
    retry: false,
  })
  const observer = new QueryObserver(queryClient, options)
  const pages = new InfiniteQueryObserver(queryClient, infinite)
  const unsubscribe = observer.subscribe(() => {})
  const unsubscribePages = pages.subscribe(() => {})
  try {
    expect(utils.users.list.queryOptions(skipToken).queryFn).toBe(skipToken)
    expect(options).toMatchObject({
      queryFn: skipToken,
      queryKey: ['test', 'http', 'pages', 'users', 'list', 'query'],
      staleTime: 123,
      meta: { label: 'waiting' },
    })
    expect(infinite).toMatchObject({
      queryFn: skipToken,
      queryKey: ['test', 'http', 'pages', 'users', 'list', 'infinite'],
      retry: false,
    })
    expect(options).not.toHaveProperty('input')
    expect(infinite).not.toHaveProperty('input')
    await queryClient.invalidateQueries({ queryKey: utils.key() })
    expect(observer.getCurrentResult().fetchStatus).toBe('idle')
    expect(pages.getCurrentResult().fetchStatus).toBe('idle')
    expect(encodings).toBe(0)
    expect(requests).toBe(0)
  } finally {
    unsubscribe()
    unsubscribePages()
    queryClient.clear()
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

it('normalizes no-content pages and owns query fields while retaining caller policy', async () => {
  const api = HttpApi.make('no-content').add(
    HttpApiGroup.make('actions', { topLevel: true }).add(
      HttpApiEndpoint.post('refresh', '/refresh'),
    ),
  )
  const handlers = HttpApiBuilder.group(api, 'actions', (handlers) =>
    handlers.handle('refresh', () => Effect.void),
  )
  const scope = Scope.makeUnsafe()
  const client = await Effect.runPromise(
    HttpApiTest.groups(api, ['actions']).pipe(
      Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)),
      Effect.provideService(Scope.Scope, scope),
    ),
  )
  const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['test'] })
  const queryClient = new QueryClient()
  try {
    const options = utils.refresh.infiniteOptions({
      initialPageParam: 0,
      getNextPageParam: (_last, _pages, page) => (page < 1 ? page + 1 : undefined),
      staleTime: Infinity,
      meta: { label: 'refresh' },
      ...({
        queryKey: ['replacement'],
        queryFn: () => 'replacement',
        queryKeyHashFn: () => 'replacement',
      } as {}),
    })
    expect(options.queryKey).toEqual(utils.refresh.infiniteKey())
    expect(options.queryKeyHashFn(options.queryKey)).toBe(JSON.stringify(options.queryKey))
    expect(options).toMatchObject({ staleTime: Infinity, meta: { label: 'refresh' } })
    expect(await queryClient.infiniteQuery({ ...options, pages: 2 })).toEqual({
      pages: [null, null],
      pageParams: [0, 1],
    })
  } finally {
    queryClient.clear()
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})
