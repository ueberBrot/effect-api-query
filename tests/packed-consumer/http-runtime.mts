// fallow-ignore-file unused-file
// The packed-package verifier executes this fixture in isolated consumers.
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Cause, Effect, Exit, Layer, Schema } from 'effect'
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  EffectHttpApiQueryError,
  isEffectHttpApiQueryError,
  skipToken,
  type RunPromiseExit,
} from 'effect-api-query'
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpServer } from 'effect/unstable/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiTest,
} from 'effect/unstable/httpapi'
import { Rpc, RpcGroup, RpcTest } from 'effect/unstable/rpc'
import { deepStrictEqual, equal, notDeepStrictEqual, ok, rejects } from 'node:assert/strict'

const api = HttpApi.make('packed-http').add(
  HttpApiGroup.make('compatibility').add(
    HttpApiEndpoint.get('read', '/value/:id', {
      params: { id: Schema.NumberFromString },
      success: Schema.NumberFromString,
      error: Schema.String,
    }),
    HttpApiEndpoint.post('write', '/value', {
      payload: Schema.Struct({ value: Schema.NumberFromString }),
      success: Schema.NumberFromString,
    }),
  ),
  HttpApiGroup.make('other').add(HttpApiEndpoint.get('read', '/other', { success: Schema.String })),
  HttpApiGroup.make('system', { topLevel: true }).add(
    HttpApiEndpoint.get('empty', '/empty', { success: HttpApiSchema.NoContent }),
  ),
)

class Authentication extends HttpApiMiddleware.Service<Authentication>()(
  'PackedHttp/Authentication',
  {
    requiredForClient: true,
  },
) {}
const identityApi = HttpApi.make('identity').add(
  HttpApiGroup.make('accounts').add(
    HttpApiEndpoint.get('read', '/account', {
      query: { locale: Schema.optional(Schema.String) },
      success: Schema.String,
    }).middleware(Authentication),
  ),
)
let identityRequests = 0
const transport = HttpClient.make((request) => {
  identityRequests += 1
  return Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      Response.json(request.headers['authorization'] === 'Bearer token-ada' ? 'Ada' : 'Grace'),
    ),
  )
})
const readyClientFor = (token: string) =>
  Effect.runPromise(
    HttpApiClient.makeWith(identityApi, {
      httpClient: transport,
      baseUrl: 'https://example.test',
    }).pipe(
      Effect.provide(
        HttpApiMiddleware.layerClient(Authentication, ({ request, next }) =>
          next(HttpClientRequest.bearerToken(request, token)),
        ),
      ),
    ),
  )
const ada = createHttpApiQueryUtils(identityApi, {
  client: await readyClientFor('token-ada'),
  keyPrefix: ['tenant', 'north', 'user', 'ada'],
})
const grace = createHttpApiQueryUtils(identityApi, {
  client: await readyClientFor('token-grace'),
  keyPrefix: ['tenant', 'north', 'user', 'grace'],
})
const south = createHttpApiQueryUtils(identityApi, {
  client: await readyClientFor('token-ada'),
  keyPrefix: ['tenant', 'south', 'user', 'ada'],
})
const identityCache = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
try {
  equal(await identityCache.query(ada.accounts.read.queryOptions({ input: { query: {} } })), 'Ada')
  equal(
    await identityCache.query(
      ada.accounts.read.queryOptions({ input: { query: { locale: undefined } } }),
    ),
    'Ada',
  )
  equal(identityRequests, 1)
  equal(
    await identityCache.query(grace.accounts.read.queryOptions({ input: { query: {} } })),
    'Grace',
  )
  equal(
    await identityCache.query(south.accounts.read.queryOptions({ input: { query: {} } })),
    'Ada',
  )
  equal(identityRequests, 3)
  notDeepStrictEqual(
    ada.accounts.read.queryKey({ query: {} }),
    grace.accounts.read.queryKey({ query: {} }),
  )
  ok(!JSON.stringify(ada.accounts.read.queryKey({ query: {} })).includes('token-ada'))
} finally {
  identityCache.clear()
}

let value = 1
const decodedRequests: Array<unknown> = []
const handlers = Layer.mergeAll(
  HttpApiBuilder.group(api, 'compatibility', (group) =>
    group
      .handle(
        'read',
        Effect.fn('PackedHttp.read')(function* ({ params }) {
          decodedRequests.push(params)
          if (params.id < 0) return yield* Effect.fail('missing')
          return value
        }),
      )
      .handle(
        'write',
        Effect.fn('PackedHttp.write')(function* ({ payload }) {
          decodedRequests.push(payload)
          value = payload.value
          return value
        }),
      ),
  ),
  HttpApiBuilder.group(api, 'other', (group) =>
    group.handle('read', () => Effect.succeed('other')),
  ),
  HttpApiBuilder.group(api, 'system', (group) => group.handle('empty', () => Effect.void)),
)

const rpc = RpcGroup.make(Rpc.make('compatibility.read', { success: Schema.String }))

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(api, ['compatibility', 'other', 'system'])
      const rpcClient = yield* RpcTest.makeClient(rpc, { flatten: true }).pipe(
        Effect.provide(rpc.toLayer({ 'compatibility.read': () => Effect.succeed('rpc') })),
      )
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Infinity },
          mutations: { retry: false, gcTime: Infinity },
        },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => queryClient.clear()))
      const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['shared'] as const })
      const rpcUtils = createRpcQueryUtils(rpc, {
        client: rpcClient,
        keyPrefix: ['shared'] as const,
      })

      const readInput = { params: { id: 1 }, responseMode: 'response-only' } as const
      // @ts-expect-error Runtime misuse still returns decoded data; response controls are private.
      const readOptions = http.compatibility.read.queryOptions({ input: readInput })
      equal(yield* Effect.promise(() => queryClient.query(readOptions)), 1)
      equal(yield* Effect.promise(() => queryClient.query(readOptions)), 1)
      deepStrictEqual(decodedRequests, [{ id: 1 }])

      const writeInput = { payload: { value: 7 }, responseMode: 'response-only' } as const
      const write = new MutationObserver(queryClient, http.compatibility.write.mutationOptions())
      // @ts-expect-error Runtime misuse cannot select a raw mutation response.
      equal(yield* Effect.promise(() => write.mutate(writeInput)), 7)
      deepStrictEqual(decodedRequests, [{ id: 1 }, { value: 7 }])
      equal(queryClient.getQueryData(readOptions.queryKey), 1)

      yield* Effect.promise(() =>
        queryClient.invalidateQueries({ queryKey: http.compatibility.read.key() }),
      )
      equal(yield* Effect.promise(() => queryClient.query(readOptions)), 7)
      equal(yield* Effect.promise(() => queryClient.query(http.empty.queryOptions())), null)
      const emptyMutation = new MutationObserver(queryClient, http.empty.mutationOptions())
      equal(yield* Effect.promise(() => emptyMutation.mutate(undefined)), undefined)
      equal(
        queryClient.getMutationCache().findAll({ mutationKey: http.empty.mutationKey() }).length,
        1,
      )
      notDeepStrictEqual(http.empty.queryKey(), http.empty.mutationKey())

      const rpcOptions = rpcUtils.compatibility.read.queryOptions()
      equal(yield* Effect.promise(() => queryClient.query(rpcOptions)), 'rpc')
      equal(yield* Effect.promise(() => queryClient.query(http.other.read.queryOptions())), 'other')
      const secondRead = http.compatibility.read.queryOptions({ input: { params: { id: 2 } } })
      equal(yield* Effect.promise(() => queryClient.query(secondRead)), 7)
      deepStrictEqual(http.key(), ['shared', 'http', 'packed-http'])
      deepStrictEqual(rpcUtils.key(), ['shared', 'rpc'])
      notDeepStrictEqual(readOptions.queryKey, rpcOptions.queryKey)
      equal(queryClient.getQueryCache().findAll({ queryKey: http.key() }).length, 4)
      equal(queryClient.getQueryCache().findAll({ queryKey: rpcUtils.key() }).length, 1)
      equal(
        queryClient.getQueryCache().findAll({ queryKey: http.compatibility.read.key() }).length,
        2,
      )

      yield* Effect.promise(() =>
        queryClient.invalidateQueries({ queryKey: http.compatibility.key() }),
      )
      equal(queryClient.getQueryState(readOptions.queryKey)?.isInvalidated, true)
      equal(queryClient.getQueryState(secondRead.queryKey)?.isInvalidated, true)
      equal(queryClient.getQueryState(http.other.read.queryKey())?.isInvalidated, false)
      equal(queryClient.getQueryState(http.empty.queryKey())?.isInvalidated, false)
      equal(queryClient.getQueryState(rpcOptions.queryKey)?.isInvalidated, false)

      yield* Effect.promise(() => queryClient.invalidateQueries({ queryKey: http.key() }))
      equal(queryClient.getQueryState(http.other.read.queryKey())?.isInvalidated, true)
      equal(queryClient.getQueryState(http.empty.queryKey())?.isInvalidated, true)
      equal(queryClient.getQueryState(rpcOptions.queryKey)?.isInvalidated, false)
      yield* Effect.promise(() => queryClient.invalidateQueries({ queryKey: ['shared'] }))
      equal(queryClient.getQueryState(rpcOptions.queryKey)?.isInvalidated, true)

      yield* Effect.promise(() =>
        rejects(
          queryClient.query(
            http.compatibility.read.queryOptions({ input: { params: { id: -1 } } }),
          ),
          (error: unknown) => {
            ok(error instanceof EffectHttpApiQueryError)
            ok(isEffectHttpApiQueryError(error))
            deepStrictEqual(
              error.cause.reasons.map((reason) => reason._tag),
              ['Fail'],
            )
            deepStrictEqual(
              error.cause.reasons.map((reason) =>
                reason._tag === 'Fail' ? reason.error : undefined,
              ),
              ['missing'],
            )
            return true
          },
        ),
      )

      const skipped = http.compatibility.read.queryOptions({ input: skipToken, staleTime: 123 })
      equal(skipped.queryFn, skipToken)
      equal(skipped.staleTime, 123)
      deepStrictEqual(skipped.queryKey, [...http.compatibility.read.key(), 'query'])
      const pages = http.compatibility.read.infiniteOptions({
        initialPageParam: 0,
        input: (id) => ({ params: { id } }),
        getNextPageParam: (_last, _pages, id) => (id < 1 ? id + 1 : undefined),
      })
      decodedRequests.length = 0
      deepStrictEqual(
        yield* Effect.promise(() => queryClient.infiniteQuery({ ...pages, pages: 2 })),
        {
          pages: [7, 7],
          pageParams: [0, 1],
        },
      )
      deepStrictEqual(decodedRequests, [{ id: 0 }, { id: 1 }])
      notDeepStrictEqual(pages.queryKey, http.compatibility.read.queryKey({ params: { id: 0 } }))
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.infiniteQuery(
            http.empty.infiniteOptions({
              initialPageParam: 0,
              getNextPageParam: () => undefined,
            }),
          ),
        ),
        { pages: [null], pageParams: [0] },
      )

      let completeCause: Cause.Cause<unknown> | undefined
      const runPromiseExit: RunPromiseExit = async (effect, options) => {
        const exit = await Effect.runPromiseExit(effect, options)
        if (Exit.isSuccess(exit)) return exit
        const cause = Cause.combine(
          exit.cause,
          Cause.combine(Cause.die(new Error('defect')), Cause.interrupt(123)),
        )
        completeCause = cause
        return Exit.failCause(cause)
      }
      const failingHttp = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ['failure'] as const,
        runPromiseExit,
      })
      yield* Effect.promise(() =>
        rejects(
          queryClient.query(
            failingHttp.compatibility.read.queryOptions({ input: { params: { id: -1 } } }),
          ),
          (error: unknown) => {
            ok(error instanceof EffectHttpApiQueryError)
            ok(completeCause)
            equal(error.cause, completeCause)
            return true
          },
        ),
      )
    }).pipe(Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices))),
  ),
)
