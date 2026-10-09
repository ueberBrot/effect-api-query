// fallow-ignore-file unused-file
// The packed-package verifier executes this fixture in isolated consumers.
import { MutationObserver, QueryClient, isCancelledError } from '@tanstack/query-core'
import { Cause, Effect, Exit, Layer, Schema } from 'effect'
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  EffectHttpApiQueryError,
  isEffectHttpApiQueryError,
  skipToken,
  type RunPromiseExit,
} from 'effect-api-query'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpServer,
  Multipart,
} from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiTest,
} from 'effect/http-api'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'
import { deepStrictEqual, equal, notDeepStrictEqual, ok, rejects } from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'

const UploadPayload = Schema.Struct({
  name: Schema.String,
  amount: Schema.NumberFromString,
  file: Multipart.SingleFileSchema,
}).pipe(HttpApiSchema.asMultipart())
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
const uploadApi = HttpApi.make('packed-uploads').add(
  HttpApiGroup.make('files').add(
    HttpApiEndpoint.post('upload', '/upload/:id', {
      params: { id: Schema.NumberFromString },
      query: { factor: Schema.NumberFromString },
      headers: { 'x-version': Schema.Literal('v1') },
      payload: UploadPayload,
      success: Schema.NumberFromString,
      error: Schema.Literal('upload-rejected'),
    }),
    HttpApiEndpoint.post('mixedUpload', '/mixed-upload', {
      payload: [Schema.Struct({ value: Schema.NumberFromString }), UploadPayload],
      success: Schema.NumberFromString,
    }),
  ),
  HttpApiGroup.make('system', { topLevel: true }).add(
    HttpApiEndpoint.post('uploaded', '/uploaded', {
      payload: UploadPayload,
      success: HttpApiSchema.NoContent,
    }),
  ),
)

const cancellationApi = HttpApi.make('packed-cancellation').add(
  HttpApiGroup.make('pages').add(
    HttpApiEndpoint.get('read', '/pages/:page', {
      params: { page: Schema.FiniteFromString },
      success: Schema.String,
    }),
  ),
)
for (const mode of ['query', 'later page'] as const) {
  let received!: () => void
  let disconnected!: () => void
  const requestReceived = new Promise<void>((resolve) => {
    received = resolve
  })
  const requestDisconnected = new Promise<void>((resolve) => {
    disconnected = resolve
  })
  const paths: string[] = []
  const server = createServer((request, response) => {
    paths.push(request.url ?? '')
    if (request.url === '/pages/0') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify('first'))
      return
    }
    response.on('close', disconnected)
    received()
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`HTTP ${mode} cancellation timed out`)), 10_000)
  })
  try {
    server.listen(0, '127.0.0.1')
    await Promise.race([once(server, 'listening'), deadline])
    const address = server.address()
    ok(address !== null && typeof address !== 'string')
    const client = await Effect.runPromise(
      HttpApiClient.make(cancellationApi, {
        baseUrl: `http://127.0.0.1:${address.port}`,
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    )
    let interrupted!: (cause: Cause.Cause<unknown>) => void
    const interruption = new Promise<Cause.Cause<unknown>>((resolve) => {
      interrupted = resolve
    })
    let requestSignal: AbortSignal | undefined
    const runPromiseExit: RunPromiseExit = async (effect, options) => {
      requestSignal = options?.signal
      const exit = await Effect.runPromiseExit(effect, options)
      if (Exit.isFailure(exit)) interrupted(exit.cause)
      return exit
    }
    const utils = createHttpApiQueryUtils(cancellationApi, {
      client,
      keyPrefix: ['packed'],
      runPromiseExit,
    })
    const pending =
      mode === 'query'
        ? queryClient.query(utils.pages.read.queryOptions({ input: { params: { page: 1 } } }))
        : queryClient.infiniteQuery({
            ...utils.pages.read.infiniteOptions({
              initialPageParam: 0,
              input: (page) => ({ params: { page } }),
              getNextPageParam: (_last, _pages, page) => page + 1,
            }),
            pages: 2,
          })
    const result = pending.catch((error: unknown) => error)
    await Promise.race([requestReceived, deadline])
    equal(requestSignal?.aborted, false)
    await queryClient.cancelQueries({ queryKey: utils.pages.read.key() })
    ok(isCancelledError(await result))
    equal(requestSignal?.aborted, true)
    ok(Cause.hasInterrupts(await Promise.race([interruption, deadline])))
    await Promise.race([requestDisconnected, deadline])
    deepStrictEqual(paths, mode === 'query' ? ['/pages/1'] : ['/pages/0', '/pages/1'])
    equal(queryClient.isFetching(), 0)
  } finally {
    clearTimeout(timeout)
    queryClient.clear()
    if (server.listening) {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      })
      server.closeAllConnections()
      await closed
    }
  }
}

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
const serializedUploadRequests: Array<unknown> = []
const uploadKinds: string[] = []
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
      const uploadClient = yield* HttpApiClient.makeWith(uploadApi, {
        baseUrl: 'https://uploads.test',
        httpClient: HttpClient.make((request) =>
          Effect.gen(function* () {
            const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
            const url = new URL(web.url)
            if (
              url.pathname === '/mixed-upload' &&
              web.headers.get('content-type')?.startsWith('application/json')
            ) {
              const body = yield* Effect.promise(() => web.json())
              deepStrictEqual(body, { value: '9' })
              uploadKinds.push('plain')
              return HttpClientResponse.fromWeb(request, Response.json('9'))
            }
            const body = yield* Effect.promise(() => web.formData())
            if (url.pathname === '/uploaded') {
              return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }))
            }
            if (url.pathname === '/mixed-upload') {
              equal(body.get('amount'), '7')
              uploadKinds.push('multipart')
              return HttpClientResponse.fromWeb(request, Response.json('7'))
            }
            if (body.get('name') === 'reject') {
              return HttpClientResponse.fromWeb(
                request,
                Response.json('upload-rejected', { status: 500 }),
              )
            }
            const file = body.get('file')
            ok(file instanceof File)
            serializedUploadRequests.push({
              url: web.url,
              version: web.headers.get('x-version'),
              name: body.get('name'),
              amount: body.get('amount'),
              fileName: file.name,
              contents: yield* Effect.promise(() => file.text()),
            })
            return HttpClientResponse.fromWeb(request, Response.json('17'))
          }),
        ),
      })
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
      const uploads = createHttpApiQueryUtils(uploadApi, {
        client: uploadClient,
        keyPrefix: ['shared'] as const,
      })
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

      const formData = new FormData()
      formData.set('name', 'Ada')
      formData.set('amount', '7')
      formData.set('file', new File(['release upload'], 'release.txt', { type: 'text/plain' }))
      const uploadInput = {
        params: { id: 3 },
        query: { factor: 2 },
        headers: { 'x-version': 'v1' as const },
        payload: formData,
      }
      const uploadCallbacks: string[] = []
      const upload = new MutationObserver(
        queryClient,
        uploads.files.upload.mutationOptions({
          onMutate: (request) => {
            equal(request, uploadInput)
            equal(request.payload, formData)
            uploadCallbacks.push('mutate')
            return 'prepared'
          },
          onSuccess: (data, request, mutateResult) => {
            equal(data, 17)
            equal(request, uploadInput)
            equal(mutateResult, 'prepared')
            uploadCallbacks.push('success')
          },
          onSettled: (data, error, request, mutateResult) => {
            equal(data, 17)
            equal(error, null)
            equal(request, uploadInput)
            equal(mutateResult, 'prepared')
            uploadCallbacks.push('settled')
          },
        }),
      )
      equal(yield* Effect.promise(() => upload.mutate(uploadInput)), 17)
      deepStrictEqual(uploadCallbacks, ['mutate', 'success', 'settled'])
      deepStrictEqual(serializedUploadRequests, [
        {
          url: 'https://uploads.test/upload/3?factor=2',
          version: 'v1',
          name: 'Ada',
          amount: '7',
          fileName: 'release.txt',
          contents: 'release upload',
        },
      ])
      deepStrictEqual(uploads.files.upload.mutationKey(), [
        'shared',
        'http',
        'packed-uploads',
        'files',
        'upload',
        'mutation',
      ])
      equal(
        queryClient.getMutationCache().findAll({ mutationKey: uploads.files.upload.key() }).length,
        1,
      )
      const mixedUpload = new MutationObserver(
        queryClient,
        uploads.files.mixedUpload.mutationOptions(),
      )
      equal(yield* Effect.promise(() => mixedUpload.mutate({ payload: { value: 9 } })), 9)
      equal(yield* Effect.promise(() => mixedUpload.mutate({ payload: formData })), 7)
      deepStrictEqual(uploadKinds, ['plain', 'multipart'])
      const completedUpload = new MutationObserver(queryClient, uploads.uploaded.mutationOptions())
      equal(yield* Effect.promise(() => completedUpload.mutate({ payload: formData })), undefined)
      equal(completedUpload.getCurrentResult().status, 'success')
      const rejectedFormData = new FormData()
      rejectedFormData.set('name', 'reject')
      rejectedFormData.set('amount', '0')
      const rejectedUpload = new MutationObserver(
        queryClient,
        uploads.files.upload.mutationOptions(),
      )
      yield* Effect.promise(() =>
        rejects(
          rejectedUpload.mutate({ ...uploadInput, payload: rejectedFormData }),
          (error: unknown) => {
            ok(isEffectHttpApiQueryError(error))
            equal(error.apiId, 'packed-uploads')
            equal(error.groupId, 'files')
            equal(error.endpoint, 'upload')
            equal(error.method, 'POST')
            equal(error.operation, 'mutation')
            deepStrictEqual(
              error.cause.reasons.map((reason) =>
                reason._tag === 'Fail' ? reason.error : undefined,
              ),
              ['upload-rejected'],
            )
            return true
          },
        ),
      )

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
