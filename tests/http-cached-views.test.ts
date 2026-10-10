import { it } from '@effect/vitest'
import { QueryClient } from '@tanstack/query-core'
import { Cause, Deferred, Effect, Exit, Predicate, Schema, SchemaTransformation } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api'
import { expect } from 'vite-plus/test'

import { createHttpApiQueryUtils, isEffectHttpApiQueryError } from '#effect-api-query'

import { captureFailure } from './fixtures/async.ts'
import { waitForQueryState } from './fixtures/query-cache.ts'

const UndefinedValue = Schema.Null.pipe(
  Schema.decodeTo(
    Schema.Void,
    SchemaTransformation.transform({ decode: () => {}, encode: () => null }),
  ),
)
const api = HttpApi.make('cached-views').add(
  HttpApiGroup.make('items').add(
    HttpApiEndpoint.get('watch', '/watch', {
      success: HttpApiSchema.StreamSse({ data: Schema.Union([Schema.Int, UndefinedValue]) }),
    }),
    HttpApiEndpoint.get('wrapped', '/wrapped', {
      success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamSse({ data: Schema.Int }), {
        'x-version': Schema.FiniteFromString,
      }),
    }),
    HttpApiEndpoint.get('read', '/read', {
      success: HttpApiSchema.WithHeaders(Schema.String, { etag: Schema.String }).pipe(
        HttpApiSchema.status(203),
      ),
    }),
  ),
)
const makeClient = (response: () => Response) =>
  HttpApiClient.makeWith(api, {
    baseUrl: 'https://example.test',
    httpClient: HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, response())),
    ),
  })
const sse = (body: string, headers = {}) =>
  new Response(body, { headers: { 'content-type': 'text/event-stream', ...headers } })

it.effect('caches decoded SSE views with distinct decoder policies and header wrappers', () =>
  Effect.gen(function* () {
    const client = yield* makeClient(() => sse('data: 1\n\ndata: null\n\n', { 'x-version': '4' }))
    const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['views'] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        queryClient.clear()
      }),
    )
    expect(
      yield* Effect.promise(
        async () => await queryClient.query(http.items.watch.streamedOptions()),
      ),
    ).toStrictEqual([1, undefined])
    expect(
      yield* Effect.promise(async () => await queryClient.query(http.items.watch.liveOptions())),
    ).toBeNull()
    const wrapped = yield* makeClient(() => sse('data: 3\n\ndata: 7\n\n', { 'x-version': '4' }))
    const wrappedHttp = createHttpApiQueryUtils(api, { client: wrapped, keyPrefix: ['wrapped'] })
    expect(
      yield* Effect.promise(
        async () => await queryClient.query(wrappedHttp.items.wrapped.streamedOptions()),
      ),
    ).toStrictEqual([
      HttpApiSchema.withHeaders({ body: 3, headers: { 'x-version': 4 } }),
      HttpApiSchema.withHeaders({ body: 7, headers: { 'x-version': 4 } }),
    ])
    expect(
      yield* Effect.promise(
        async () => await queryClient.query(wrappedHttp.items.wrapped.liveOptions()),
      ),
    ).toStrictEqual(HttpApiSchema.withHeaders({ body: 7, headers: { 'x-version': 4 } }))
    expect(http.items.watch.streamedKey()).toStrictEqual(
      http.items.watch.streamedKey({ sseOptions: { maxEventSize: 10 * 1024 * 1024 } }),
    )
    expect(http.items.watch.streamedKey()).not.toStrictEqual(
      http.items.watch.streamedKey({ sseOptions: { maxEventSize: 3 } }),
    )
    const decoderClient = yield* makeClient(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: 12345'))
              controller.enqueue(new TextEncoder().encode('\n\n'))
              controller.close()
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const decoderHttp = createHttpApiQueryUtils(api, {
      client: decoderClient,
      keyPrefix: ['decoder'],
    })
    const failed = yield* Effect.promise(
      async () =>
        await captureFailure(
          queryClient.query(
            decoderHttp.items.watch.streamedOptions({ sseOptions: { maxEventSize: 3 } }),
          ),
        ),
    )
    expect(failed).toMatchObject({
      _tag: 'EffectHttpApiQueryError',
      operation: 'streamed',
      endpoint: 'watch',
    })
    if (!isEffectHttpApiQueryError(failed)) {
      throw new TypeError('Expected an HTTP execution error')
    }
    expect(failed.cause.reasons[0]).toMatchObject({ _tag: 'Fail', error: { _tag: 'SseError' } })
    expect(queryClient.getQueryData(http.items.watch.streamedKey())).toStrictEqual([1, undefined])
  }),
)

it.effect.each(['live', 'streamed'] as const)(
  'preserves mixed acquisition Causes in HTTP %s views',
  (view) =>
    Effect.gen(function* () {
      const defect = new Error('transport defect')
      const cause = Cause.combine(Cause.interrupt(123), Cause.die(defect))
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: 'https://example.test',
        httpClient: HttpClient.make(() => Effect.failCause(cause)),
      })
      const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['failure', view] })
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          queryClient.clear()
        }),
      )
      const error = yield* Effect.promise(
        async () =>
          await captureFailure(
            view === 'live'
              ? queryClient.query(http.items.watch.liveOptions())
              : queryClient.query(http.items.watch.streamedOptions()),
          ),
      )
      expect(error).toMatchObject({
        _tag: 'EffectHttpApiQueryError',
        apiId: 'cached-views',
        groupId: 'items',
        endpoint: 'watch',
        method: 'GET',
        operation: view,
      })
      if (!isEffectHttpApiQueryError(error)) {
        throw new TypeError('Expected an HTTP execution error')
      }
      expect(error.cause.reasons.map((reason) => reason._tag)).toStrictEqual(['Interrupt', 'Die'])
      expect(error.cause.reasons[0]).toMatchObject({ fiberId: 123 })
      const [, reason] = error.cause.reasons
      if (reason?._tag !== 'Die') {
        throw new TypeError('Expected the original defect')
      }
      expect(reason.defect).toBe(defect)
    }),
)

it.effect.each(
  (['live', 'streamed'] as const).flatMap((view) => [
    { view, body: 'data: "bad"\n\n', tag: 'SchemaError', published: false },
    { view, body: 'id: v3\ndata: 1\n\nretry: 25\n\n', tag: 'Retry', published: true },
  ]),
)('preserves HTTP $view failure $tag and prior publication', ({ view, body, tag, published }) =>
  Effect.gen(function* () {
    const client = yield* makeClient(() => sse(body))
    const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['decode', view] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        queryClient.clear()
      }),
    )
    const error = yield* Effect.promise(
      async () =>
        await captureFailure(
          view === 'live'
            ? queryClient.query(http.items.watch.liveOptions())
            : queryClient.query(http.items.watch.streamedOptions()),
        ),
    )
    if (!isEffectHttpApiQueryError(error)) {
      throw new TypeError('Expected an HTTP execution error')
    }
    expect(error.cause.reasons[0]).toMatchObject({ _tag: 'Fail', error: { _tag: tag } })
    const publishedData = view === 'live' ? 1 : [1]
    expect(
      queryClient.getQueryData(
        view === 'live' ? http.items.watch.liveKey() : http.items.watch.streamedKey(),
      ),
    ).toStrictEqual(published ? publishedData : undefined)
  }),
)

it.effect.each(['live', 'streamed'] as const)(
  'cancels and closes an HTTP %s body after the first publication',
  (view) =>
    Effect.gen(function* () {
      const finalized = yield* Deferred.make<undefined>()
      let signal: AbortSignal | undefined
      let closed = 0
      const client = yield* HttpApiClient.makeWith(api, {
        baseUrl: 'https://example.test',
        httpClient: HttpClient.make((request, _url, transportSignal) => {
          signal = transportSignal
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode('data: 1\n\n'))
                  },
                  cancel() {
                    closed += 1
                    Deferred.doneUnsafe(finalized, Exit.succeed(undefined))
                  },
                }),
                { headers: { 'content-type': 'text/event-stream' } },
              ),
            ),
          )
        }),
      })
      const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['cancel', view] })
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const queryKey = view === 'live' ? http.items.watch.liveKey() : http.items.watch.streamedKey()
      const pending =
        view === 'live'
          ? queryClient.query(http.items.watch.liveOptions())
          : queryClient.query(http.items.watch.streamedOptions())
      try {
        yield* waitForQueryState(
          queryClient,
          () => queryClient.getQueryState(queryKey)?.status === 'success',
        )
        expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('fetching')
        yield* Effect.promise(async () => {
          await queryClient.cancelQueries({ queryKey, exact: true })
        })
        yield* Deferred.await(finalized)
        expect(signal?.aborted).toBe(true)
        expect(closed).toBe(1)
        expect(yield* Effect.promise(async () => await pending)).toStrictEqual(
          view === 'live' ? 1 : [1],
        )
      } finally {
        yield* Effect.promise(async () => {
          await queryClient.cancelQueries({ queryKey, exact: true })
        })
        queryClient.clear()
      }
    }),
)

it.effect(
  'captures immutable HTTP metadata separately from decoded data and preserves native sharing',
  () =>
    Effect.gen(function* () {
      let revision = 1
      const client = yield* makeClient(() =>
        Response.json('document', {
          status: 203,
          headers: { 'content-type': 'application/json', etag: `"revision-${revision}"` },
        }),
      )
      const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['metadata'] })
      const queryClient = new QueryClient()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          queryClient.clear()
        }),
      )
      const options = http.items.read.metadataOptions()
      const first = yield* Effect.promise(async () => await queryClient.query(options))
      expect(first).toMatchObject({
        data: { body: 'document', headers: { etag: '"revision-1"' } },
        status: 203,
        headers: { etag: '"revision-1"' },
      })
      expect(Object.isFrozen(first)).toBe(true)
      expect(Object.isFrozen(first.headers)).toBe(true)
      expect(
        yield* Effect.promise(async () => await queryClient.query(http.items.read.queryOptions())),
      ).toStrictEqual(first.data)
      expect(queryClient.getQueryCache().findAll({ queryKey: http.items.read.key() })).toHaveLength(
        2,
      )
      revision = 2
      const second = yield* Effect.promise(async () => await queryClient.query(options))
      expect(second.headers['etag']).toBe('"revision-2"')
      expect(first.headers['etag']).toBe('"revision-1"')
      const cached = queryClient.getQueryData(options.queryKey)
      yield* Effect.promise(async () => await queryClient.query(options))
      expect(queryClient.getQueryData(options.queryKey)).toBe(cached)
      queryClient.setQueryDefaults(http.items.read.key(), {
        structuralSharing: (_previous, data) => {
          if (!Predicate.isObject(data)) {
            throw new TypeError('Expected a metadata view')
          }
          return { ...data, status: 211 }
        },
      })
      yield* Effect.promise(async () => await queryClient.query(http.items.read.metadataOptions()))
      const shared = queryClient.getQueryData(options.queryKey)
      if (shared === undefined) {
        throw new TypeError('Expected cached metadata')
      }
      expect(shared.status).toBe(211)
      expect(Object.isFrozen(shared)).toBe(true)
      expect(Object.isFrozen(shared.headers)).toBe(true)
      const manual = { ...shared, headers: { etag: 'manual' } }
      queryClient.setQueryData(options.queryKey, manual)
      expect(Object.isFrozen(manual)).toBe(false)
      expect(Object.isFrozen(manual.headers)).toBe(false)
    }),
)
