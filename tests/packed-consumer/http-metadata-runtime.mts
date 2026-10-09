import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core'
import { Cause, Effect, Exit, Layer, Result, Schema } from 'effect'
import {
  createHttpApiQueryUtils,
  EffectHttpApiQueryConfigError,
  isEffectHttpApiQueryError,
  skipToken,
  type RunPromiseExit,
} from 'effect-api-query'
import { HttpClient, HttpClientResponse, HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiTest,
} from 'effect/http-api'
import { deepStrictEqual, equal, notDeepStrictEqual, ok, rejects, throws } from 'node:assert/strict'

const Conflict = Schema.TaggedStruct('Conflict', {}).pipe(HttpApiSchema.status(412))

const api = HttpApi.make('packed-metadata').add(
  HttpApiGroup.make('documents').add(
    HttpApiEndpoint.post('read', '/documents/:id', {
      params: { id: Schema.FiniteFromString },
      query: { factor: Schema.FiniteFromString },
      headers: { 'x-request-version': Schema.FiniteFromString },
      payload: Schema.Struct({ amount: Schema.FiniteFromString }),
      success: HttpApiSchema.WithHeaders(Schema.FiniteFromString, {
        'x-version': Schema.FiniteFromString,
        etag: Schema.String,
      }).pipe(HttpApiSchema.status(203)),
      error: Schema.Literal('missing'),
    }),
    HttpApiEndpoint.put('update', '/documents/:id', {
      params: { id: Schema.FiniteFromString },
      headers: { 'if-match': Schema.String },
      payload: Schema.Struct({ value: Schema.FiniteFromString }),
      success: Schema.FiniteFromString,
      error: Conflict,
    }),
  ),
  HttpApiGroup.make('system', { topLevel: true }).add(
    HttpApiEndpoint.get('empty', '/empty', { success: HttpApiSchema.NoContent }),
    HttpApiEndpoint.get('wrappedEmpty', '/wrapped-empty', {
      success: HttpApiSchema.WithHeaders(HttpApiSchema.NoContent, { etag: Schema.String }),
    }),
  ),
)

const requests: unknown[] = []
let revision = 4
let savedValue: number | undefined
const handlers = Layer.mergeAll(
  HttpApiBuilder.group(api, 'documents', (group) =>
    group
      .handle('read', ({ params, query, headers, payload }) => {
        requests.push({ params, query, headers, payload })
        if (params.id < 0) return Effect.fail('missing')
        return Effect.succeed(
          HttpApiSchema.withHeaders({
            body:
              savedValue ??
              params.id + query.factor + headers['x-request-version'] + payload.amount,
            headers: { 'x-version': revision, etag: `"revision-${revision}"` },
          }),
        )
      })
      .handle('update', ({ headers, payload }) => {
        if (headers['if-match'] !== `"revision-${revision}"`) {
          return Effect.fail({ _tag: 'Conflict' as const })
        }
        savedValue = payload.value
        revision += 1
        return Effect.succeed(savedValue)
      }),
  ),
  HttpApiBuilder.group(api, 'system', (group) =>
    group
      .handle('empty', () => Effect.void)
      .handle('wrappedEmpty', () =>
        Effect.succeed(HttpApiSchema.withHeaders({ body: undefined, headers: { etag: 'empty' } })),
      ),
  ),
)

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(api, ['documents', 'system'])
      const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['metadata'] })
      const queryClient = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => queryClient.clear()))
      const input = {
        params: { id: 1 },
        query: { factor: 2 },
        headers: { 'x-request-version': 3 },
        payload: { amount: 7 },
      }
      const options = http.documents.read.metadataOptions({ input })
      const metadata = yield* Effect.promise(() => queryClient.query(options))
      deepStrictEqual(
        metadata.data,
        HttpApiSchema.withHeaders({
          body: 13,
          headers: { 'x-version': 4, etag: '"revision-4"' },
        }),
      )
      equal(metadata.status, 203)
      equal(metadata.headers['x-version'], '4')
      equal(metadata.headers['etag'], '"revision-4"')
      equal(Object.getPrototypeOf(metadata), Object.prototype)
      equal(Object.getPrototypeOf(metadata.headers), Object.prototype)
      equal(Object.isFrozen(metadata), true)
      equal(Object.isFrozen(metadata.headers), true)
      deepStrictEqual(Object.keys(metadata).sort(), ['data', 'headers', 'status'])
      deepStrictEqual(requests, [input])
      deepStrictEqual(http.documents.read.metadataKey(input), options.queryKey)
      notDeepStrictEqual(options.queryKey, http.documents.read.queryKey(input))
      const data = yield* Effect.promise(() =>
        queryClient.query(http.documents.read.queryOptions({ input })),
      )
      deepStrictEqual(data, metadata.data)
      equal(queryClient.getQueryCache().findAll({ queryKey: http.documents.read.key() }).length, 2)
      const selected = new QueryObserver(
        queryClient,
        http.documents.read.metadataOptions({
          input,
          select: (view) => view.data.body,
        }),
      )
      equal(selected.getCurrentResult().data, 13)
      equal(queryClient.getQueryData(options.queryKey), metadata)
      const empty = yield* Effect.promise(() => queryClient.query(http.empty.metadataOptions()))
      equal(empty.data, null)
      equal(empty.status, 204)
      const wrappedEmpty = yield* Effect.promise(() =>
        queryClient.query(http.wrappedEmpty.metadataOptions()),
      )
      deepStrictEqual(
        wrappedEmpty.data,
        HttpApiSchema.withHeaders({ body: undefined, headers: { etag: 'empty' } }),
      )

      const etag = metadata.headers['etag']
      ok(etag !== undefined)
      yield* Effect.promise(() =>
        queryClient.cancelQueries({ queryKey: http.documents.read.key() }),
      )
      const update = new MutationObserver(
        queryClient,
        http.documents.update.mutationOptions({
          onSuccess: () => queryClient.invalidateQueries({ queryKey: http.documents.read.key() }),
        }),
      )
      equal(
        yield* Effect.promise(() =>
          update.mutate({
            params: { id: 1 },
            headers: { 'if-match': etag },
            payload: { value: 29 },
          }),
        ),
        29,
      )
      equal(queryClient.getQueryState(options.queryKey)?.isInvalidated, true)
      equal(queryClient.getQueryState(http.documents.read.queryKey(input))?.isInvalidated, true)
      const refreshed = yield* Effect.promise(() => queryClient.query(options))
      equal(refreshed.data.body, 29)
      equal(refreshed.headers['etag'], '"revision-5"')
      equal(metadata.headers['etag'], '"revision-4"')
      yield* Effect.promise(() =>
        rejects(
          update.mutate({
            params: { id: 1 },
            headers: { 'if-match': etag },
            payload: { value: 30 },
          }),
          (error: unknown) => {
            ok(isEffectHttpApiQueryError(error))
            equal(error.operation, 'mutation')
            const failure = Cause.findError(error.cause)
            ok(Result.isSuccess(failure))
            deepStrictEqual(failure.success, { _tag: 'Conflict' })
            return true
          },
        ),
      )

      const skipped = http.documents.read.metadataOptions({ input: skipToken, staleTime: 123 })
      equal(skipped.queryFn, skipToken)
      equal(skipped.staleTime, 123)
      deepStrictEqual(skipped.queryKey, [...http.documents.read.key(), 'metadata'])
      for (const option of ['queryKeyHashFn', 'queryHash']) {
        throws(
          () => http.documents.read.metadataOptions({ input: skipToken, [option]: undefined }),
          (error: unknown) =>
            error instanceof EffectHttpApiQueryConfigError && error.code === 'UnsupportedQueryHash',
        )
      }

      let completeCause: Cause.Cause<unknown> | undefined
      const runPromiseExit: RunPromiseExit = async (effect, runnerOptions) => {
        const exit = await Effect.runPromiseExit(effect, runnerOptions)
        if (Exit.isSuccess(exit)) return exit
        const cause = Cause.combine(
          exit.cause,
          Cause.combine(Cause.die('defect'), Cause.interrupt(123)),
        )
        completeCause = cause
        return Exit.failCause(cause)
      }
      const failing = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ['failing'],
        runPromiseExit,
      })
      yield* Effect.promise(() =>
        rejects(
          queryClient.query(
            failing.documents.read.metadataOptions({
              input: { ...input, params: { id: -1 } },
            }),
          ),
          (error: unknown) => {
            ok(isEffectHttpApiQueryError(error))
            equal(error.apiId, 'packed-metadata')
            equal(error.groupId, 'documents')
            equal(error.endpoint, 'read')
            equal(error.method, 'POST')
            equal(error.operation, 'metadata')
            equal(error.cause, completeCause)
            deepStrictEqual(
              error.cause.reasons.map((reason) => reason._tag),
              ['Fail', 'Die', 'Interrupt'],
            )
            return true
          },
        ),
      )
      const rejected = new Error('runner rejected')
      const rejectingRunner: RunPromiseExit = () => Promise.reject(rejected)
      const rejecting = createHttpApiQueryUtils(api, {
        client,
        keyPrefix: ['rejection'],
        runPromiseExit: rejectingRunner,
      })
      yield* Effect.promise(() =>
        rejects(
          queryClient.query(rejecting.empty.metadataOptions()),
          (error: unknown) => error === rejected,
        ),
      )
    }).pipe(Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices))),
  ),
)

const wireApi = HttpApi.make('metadata-wire').add(
  HttpApiGroup.make('documents').add(
    HttpApiEndpoint.get('read', '/read', {
      success: HttpApiSchema.WithHeaders(Schema.FiniteFromString, {
        'x-version': Schema.FiniteFromString,
      }),
    }),
  ),
)
let response: HttpClientResponse.HttpClientResponse | undefined
let web: Response | undefined
let responseReady: () => void = () => undefined
let endBody: () => void = () => undefined
const client = await Effect.runPromise(
  HttpApiClient.makeWith(wireApi, {
    baseUrl: 'https://metadata.test',
    httpClient: HttpClient.make((request) => {
      web = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('"42"'))
            endBody = () => controller.close()
          },
        }),
        {
          headers: {
            'content-type': 'application/json',
            'x-version': '4',
            authorization: 'raw-header-value',
          },
        },
      )
      response = HttpClientResponse.fromWeb(request, web)
      responseReady()
      return Effect.succeed(response)
    }),
  }),
)
for (const mode of ['global', 'prefix'] as const) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: false,
        ...(mode === 'global' ? { queryKeyHashFn: (key) => `global:${JSON.stringify(key)}` } : {}),
      },
    },
  })
  try {
    const http = createHttpApiQueryUtils(wireApi, { client, keyPrefix: ['wire', mode] })
    if (mode === 'prefix')
      queryClient.setQueryDefaults(http.key(), {
        queryKeyHashFn: (key) => `prefix:${JSON.stringify(key)}`,
      })
    const received = new Promise<void>((resolve) => {
      responseReady = resolve
    })
    const pending = queryClient.query(http.documents.read.metadataOptions())
    await received
    equal(queryClient.getQueryData(http.documents.read.metadataKey()), undefined)
    equal(queryClient.isFetching(), 1)
    endBody()
    const view = await pending
    equal(view.data.body, 42)
    equal(view.headers['authorization'], 'raw-header-value')
    equal(view.headers['x-version'], '4')
    equal(web?.bodyUsed, true)
    notDeepStrictEqual(
      Object.getPrototypeOf(view.headers),
      Object.getPrototypeOf(response?.headers),
    )
    ok(view.headers !== response?.headers)
    equal(queryClient.getQueryData(http.documents.read.metadataKey()), view)
    queryClient.setQueryData(http.documents.read.metadataKey(), { ...view, status: 203 })
    equal(queryClient.getQueryData(http.documents.read.metadataKey())?.status, 203)
    equal(queryClient.getQueryCache().findAll({ queryKey: http.documents.read.key() }).length, 1)
  } finally {
    queryClient.clear()
  }
}
