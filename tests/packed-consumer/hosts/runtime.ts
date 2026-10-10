import { MutationObserver, QueryClient, skipToken as coreSkipToken } from '@tanstack/query-core'
import { Deferred, Effect, Exit, Layer, Schema, Scope, Stream } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils, skipToken } from 'effect-api-query'
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

const group = RpcGroup.make(
  Rpc.make('host.read', { payload: { offset: Schema.Int }, success: Schema.Finite }),
  Rpc.make('host.write', { payload: { value: Schema.Finite }, success: Schema.Finite }),
  Rpc.make('host.watch', { success: Schema.Finite, stream: true }),
  Rpc.make('host.open', { success: Schema.Finite, stream: true }),
)
const api = HttpApi.make('host-http').add(
  HttpApiGroup.make('values').add(
    HttpApiEndpoint.get('read', '/value', {
      query: { offset: Schema.FiniteFromString },
      success: HttpApiSchema.WithHeaders(Schema.Finite, { 'x-owner': Schema.String }),
    }),
    HttpApiEndpoint.post('write', '/value', {
      payload: Schema.Struct({ value: Schema.FiniteFromString }),
      success: Schema.Finite,
    }),
    HttpApiEndpoint.get('watch', '/watch', {
      success: HttpApiSchema.StreamSse({ data: Schema.Finite }),
    }),
    HttpApiEndpoint.get('open', '/open', {
      success: HttpApiSchema.StreamSse({ data: Schema.Finite }),
    }),
  ),
)

const makeOwner = Effect.fnUntraced(function* (name: string, initial: number) {
  const scope = yield* Scope.make()
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const events: string[] = []
  const openStreams = new Set<Deferred.Deferred<void>>()
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      events.push(`${name}:disposed`)
    }),
  ).pipe(Effect.provideService(Scope.Scope, scope))
  const open = (transport: string, value: number) =>
    Stream.suspend(() => {
      const finalized = Deferred.makeUnsafe<void>()
      openStreams.add(finalized)
      return Stream.succeed(value).pipe(
        Stream.concat(Stream.fromEffect(Effect.never)),
        Stream.ensuring(
          Effect.sync(() => {
            events.push(`${name}:${transport}-finalized`)
            openStreams.delete(finalized)
            Effect.runSync(Deferred.succeed(finalized, undefined))
          }),
        ),
      )
    })
  let rpcValue = initial
  let httpValue = initial
  const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
    Effect.provide(
      group.toLayer({
        'host.read': ({ offset }) => Effect.sync(() => rpcValue + offset),
        'host.write': ({ value }) =>
          Effect.sync(() => {
            rpcValue = value
            return value
          }),
        'host.watch': () => Stream.make(rpcValue, rpcValue + 1, rpcValue + 2),
        'host.open': () => open('rpc', rpcValue),
      }),
    ),
    Effect.provideService(Scope.Scope, scope),
  )
  const httpClient = yield* HttpApiTest.groups(api, ['values']).pipe(
    Effect.provide(
      Layer.mergeAll(
        HttpServer.layerServices,
        HttpApiBuilder.group(api, 'values', (handlers) =>
          handlers
            .handle('read', ({ query }) =>
              Effect.sync(() =>
                HttpApiSchema.withHeaders({
                  body: httpValue + query.offset,
                  headers: { 'x-owner': name },
                }),
              ),
            )
            .handle('write', ({ payload }) =>
              Effect.sync(() => {
                httpValue = payload.value
                return httpValue
              }),
            )
            .handle('watch', () =>
              Effect.succeed(Stream.make(httpValue, httpValue + 1, httpValue + 2)),
            )
            .handle('open', () => Effect.succeed(open('http', httpValue))),
        ),
      ),
    ),
    Effect.provideService(Scope.Scope, scope),
  )
  return {
    cache,
    events,
    rpc: createRpcQueryUtils(group, { client, keyPrefix: ['host', name] }),
    http: createHttpApiQueryUtils(api, { client: httpClient, keyPrefix: ['host', name] }),
    async dispose() {
      const drains = [...openStreams]
      try {
        await cache.cancelQueries()
        await Effect.runPromise(
          Effect.all(drains.map(Deferred.await)).pipe(Effect.timeout('5 seconds')),
        )
      } finally {
        cache.clear()
        await Effect.runPromise(Scope.close(scope, Exit.void))
      }
    },
  }
})

const waitForData = async (cache: QueryClient, check: () => boolean) => {
  const ready = Deferred.makeUnsafe<void>()
  const observe = () => {
    if (check()) Effect.runSync(Deferred.succeed(ready, undefined))
  }
  const unsubscribe = cache.getQueryCache().subscribe(observe)
  try {
    observe()
    await Effect.runPromise(Deferred.await(ready).pipe(Effect.timeout('5 seconds')))
  } finally {
    unsubscribe()
  }
}

export const runHostOperations = async () => {
  const owner = await Effect.runPromise(makeOwner('Ada', 10))
  const second = await Effect.runPromise(makeOwner('Grace', 20))
  const { cache, rpc, http } = owner
  const rpcInput = { offset: 0 }
  const httpInput = { query: { offset: 0 } }
  try {
    const read = await cache.query(rpc.host.read.queryOptions({ input: rpcInput }))
    const rpcMutation = await new MutationObserver(cache, rpc.host.write.mutationOptions()).mutate({
      value: 41,
    })
    const rpcAfter = await cache.query(rpc.host.read.queryOptions({ input: rpcInput }))
    const rpcAccumulated = await cache.query(rpc.host.watch.streamedOptions())
    const rpcLive = await cache.query(rpc.host.watch.liveOptions())
    const httpRead = await cache.query(http.values.read.queryOptions({ input: httpInput }))
    const httpMutation = await new MutationObserver(
      cache,
      http.values.write.mutationOptions(),
    ).mutate({ payload: { value: 52 } })
    const httpAfter = await cache.query(http.values.read.queryOptions({ input: httpInput }))
    const httpAccumulated = await cache.query(http.values.watch.streamedOptions())
    const httpLive = await cache.query(http.values.watch.liveOptions())
    const metadata = await cache.query(http.values.read.metadataOptions({ input: httpInput }))
    const before = [
      await second.cache.query(second.rpc.host.read.queryOptions({ input: rpcInput })),
      (await second.cache.query(second.http.values.read.queryOptions({ input: httpInput }))).body,
    ]
    const firstRpcOpen = rpc.host.open.streamedOptions()
    const firstHttpOpen = http.values.open.liveOptions()
    const secondRpcOpen = second.rpc.host.open.streamedOptions()
    const secondHttpOpen = second.http.values.open.liveOptions()
    const pending = [
      cache.query(firstRpcOpen),
      cache.query(firstHttpOpen),
      second.cache.query(secondRpcOpen),
      second.cache.query(secondHttpOpen),
    ].map((promise) => promise.catch((error: unknown) => error))
    await Promise.all([
      waitForData(
        cache,
        () =>
          cache.getQueryData(firstRpcOpen.queryKey)?.[0] === 41 &&
          cache.getQueryData(firstHttpOpen.queryKey) === 52,
      ),
      waitForData(
        second.cache,
        () =>
          second.cache.getQueryData(secondRpcOpen.queryKey)?.[0] === 20 &&
          second.cache.getQueryData(secondHttpOpen.queryKey) === 20,
      ),
    ])
    const activeBefore = [cache.isFetching(), second.cache.isFetching()]
    await owner.dispose()
    const activeAfterFirst = [cache.isFetching(), second.cache.isFetching()]
    const secondData = [
      second.cache.getQueryData(secondRpcOpen.queryKey)?.[0],
      second.cache.getQueryData(secondHttpOpen.queryKey),
    ]
    await second.dispose()
    await Promise.all(pending)
    return {
      host: globalThis.constructor.name,
      read,
      rpc: { mutation: rpcMutation, after: rpcAfter, accumulated: rpcAccumulated, live: rpcLive },
      http: {
        read: { body: httpRead.body, headers: httpRead.headers },
        mutation: httpMutation,
        after: { body: httpAfter.body, headers: httpAfter.headers },
        accumulated: httpAccumulated,
        live: httpLive,
        metadata: {
          data: { body: metadata.data.body, headers: metadata.data.headers },
          status: metadata.status,
          owner: metadata.headers['x-owner'],
          frozenSnapshot: Object.isFrozen(metadata),
          frozenHeaders: Object.isFrozen(metadata.headers),
        },
      },
      skipIdentity: [
        skipToken === coreSkipToken,
        rpc.host.read.queryOptions({ input: skipToken }).queryFn === coreSkipToken,
        http.values.read.queryOptions({ input: skipToken }).queryFn === coreSkipToken,
      ],
      ownership: {
        before,
        activeBefore,
        activeAfterFirst,
        secondData,
        activeAfterBoth: [cache.isFetching(), second.cache.isFetching()],
        firstEvents: owner.events,
        secondEvents: second.events,
      },
    }
  } finally {
    await owner.dispose()
    await second.dispose()
  }
}
