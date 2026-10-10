import { QueryClient, QueryObserver, isCancelledError } from '@tanstack/query-core'
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Schema,
  SchemaTransformation,
  Stream,
} from 'effect'
import {
  createHttpApiQueryUtils,
  EffectHttpApiQueryConfigError,
  EffectHttpApiQueryEmptyStreamError,
  EffectHttpApiQueryError,
  skipToken,
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

const UndefinedValue = Schema.Null.pipe(
  Schema.decodeTo(
    Schema.Void,
    SchemaTransformation.transform({
      decode: (): void => undefined,
      encode: (_value: void) => null,
    }),
  ),
)
const Expired = Schema.TaggedStruct('Expired', { reason: Schema.String })
const api = HttpApi.make('http-live').add(
  HttpApiGroup.make('events').add(
    HttpApiEndpoint.get('watch', '/watch', {
      query: { channel: Schema.String },
      success: HttpApiSchema.StreamSse({ data: Schema.Finite, error: Expired }),
    }),
    HttpApiEndpoint.get('nullable', '/nullable', {
      success: HttpApiSchema.StreamSse({ data: Schema.NullOr(Schema.Finite) }),
    }),
    HttpApiEndpoint.get('undefined', '/undefined', {
      success: HttpApiSchema.StreamSse({ data: UndefinedValue }),
    }),
    HttpApiEndpoint.get('mixedUndefined', '/mixed-undefined', {
      success: HttpApiSchema.StreamSse({ data: Schema.Union([Schema.Finite, UndefinedValue]) }),
    }),
    HttpApiEndpoint.get('wrapped', '/wrapped', {
      success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamSse({ data: Schema.Finite }), {
        'x-version': Schema.FiniteFromString,
      }),
    }),
    HttpApiEndpoint.get('wrappedUndefined', '/wrapped-undefined', {
      success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamSse({ data: UndefinedValue }), {
        'x-version': Schema.FiniteFromString,
      }),
    }),
    HttpApiEndpoint.get('empty', '/empty', {
      success: HttpApiSchema.StreamSse({ data: Schema.Finite }),
    }),
    HttpApiEndpoint.get('cursor', '/cursor', {
      headers: { 'last-event-id': Schema.String },
      success: HttpApiSchema.StreamSse({
        events: Schema.Struct({
          id: Schema.String,
          event: Schema.Literal('changed'),
          data: Schema.String,
        }),
      }),
    }),
  ),
)
const handlers = HttpApiBuilder.group(api, 'events', (group) =>
  group
    .handle('watch', ({ query }) =>
      Effect.succeed(
        query.channel === 'failure'
          ? Stream.concat(
              Stream.succeed(1),
              Stream.fail({ _tag: 'Expired' as const, reason: 'resume' }),
            )
          : query.channel === 'interruption'
            ? Stream.failCause(Cause.interrupt(123))
            : query.channel === 'mixed'
              ? Stream.failCause(
                  Cause.combine(Cause.interrupt(123), Cause.die(new Error('defect'))),
                )
              : Stream.make(1, 2, 3),
      ),
    )
    .handle('nullable', () => Effect.succeed(Stream.make(1, null)))
    .handle('undefined', () => Effect.succeed(Stream.succeed(undefined)))
    .handle('mixedUndefined', () => Effect.succeed(Stream.make(1, undefined)))
    .handle('wrapped', () =>
      Effect.succeed(
        HttpApiSchema.withHeaders({ body: Stream.make(3, 7), headers: { 'x-version': 4 } }),
      ),
    )
    .handle('wrappedUndefined', () =>
      Effect.succeed(
        HttpApiSchema.withHeaders({ body: Stream.succeed(undefined), headers: { 'x-version': 4 } }),
      ),
    )
    .handle('empty', () => Effect.succeed(Stream.empty))
    .handle('cursor', ({ headers }) =>
      Effect.succeed(
        Stream.succeed({ id: headers['last-event-id'], event: 'changed' as const, data: 'next' }),
      ),
    ),
)
const waitFor = async (client: QueryClient, check: () => boolean) => {
  const ready = Deferred.makeUnsafe<undefined>()
  const observe = () => {
    if (check()) Effect.runSync(Deferred.succeed(ready, undefined))
  }
  const unsubscribe = client.getQueryCache().subscribe(observe)
  try {
    observe()
    await Effect.runPromise(Deferred.await(ready).pipe(Effect.timeout('5 seconds')))
  } finally {
    unsubscribe()
  }
}
const sse = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { 'content-type': 'text/event-stream', ...headers } })
const makeClient = (response: () => Response) =>
  Effect.runPromise(
    HttpApiClient.makeWith(api, {
      baseUrl: 'https://example.test',
      httpClient: HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, response())),
      ),
    }),
  )
const expectFailure =
  (endpoint: string, check: (cause: Cause.Cause<unknown>) => void) => (error: unknown) => {
    ok(error instanceof EffectHttpApiQueryError)
    equal(error.apiId, 'http-live')
    equal(error.groupId, 'events')
    equal(error.endpoint, endpoint)
    equal(error.method, 'GET')
    equal(error.operation, 'live')
    check(error.cause)
    return true
  }

await Effect.runPromise(
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(api, ['events'])
    const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['consumer'] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const input = { query: { channel: 'news' } }
    try {
      equal(
        yield* Effect.promise(() => queryClient.query(http.events.watch.liveOptions({ input }))),
        3,
      )
      equal(queryClient.getQueryData(http.events.watch.liveKey(input)), 3)
      equal(
        yield* Effect.promise(() => queryClient.query(http.events.nullable.liveOptions())),
        null,
      )
      equal(
        yield* Effect.promise(() => queryClient.query(http.events.undefined.liveOptions())),
        null,
      )
      equal(
        yield* Effect.promise(() => queryClient.query(http.events.mixedUndefined.liveOptions())),
        null,
      )
      deepStrictEqual(
        yield* Effect.promise(() => queryClient.query(http.events.wrapped.liveOptions())),
        HttpApiSchema.withHeaders({ body: 7, headers: { 'x-version': 4 } }),
      )
      deepStrictEqual(
        yield* Effect.promise(() => queryClient.query(http.events.wrappedUndefined.liveOptions())),
        HttpApiSchema.withHeaders({ body: undefined, headers: { 'x-version': 4 } }),
      )
      yield* Effect.promise(() =>
        rejects(queryClient.query(http.events.empty.liveOptions()), (error: unknown) => {
          ok(error instanceof EffectHttpApiQueryEmptyStreamError)
          equal(error._tag, 'EffectHttpApiQueryEmptyStreamError')
          equal(error.apiId, 'http-live')
          equal(error.groupId, 'events')
          equal(error.endpoint, 'empty')
          equal(error.method, 'GET')
          equal(error.operation, 'live')
          return true
        }),
      )
      for (const channel of ['failure', 'interruption', 'mixed']) {
        const options = http.events.watch.liveOptions({ input: { query: { channel } } })
        yield* Effect.promise(() =>
          rejects(
            queryClient.query(options),
            expectFailure('watch', (cause) => {
              if (channel === 'failure')
                deepStrictEqual(
                  cause.reasons.map((reason) =>
                    reason._tag === 'Fail' ? reason.error : reason._tag,
                  ),
                  [{ _tag: 'Expired', reason: 'resume' }],
                )
              else ok(Cause.hasInterrupts(cause))
              if (channel === 'mixed') ok(Cause.hasDies(cause))
            }),
          ),
        )
        if (channel === 'failure') equal(queryClient.getQueryData(options.queryKey), 1)
      }
      for (const cursor of ['v1', 'v2']) {
        const options = http.events.cursor.liveOptions({
          input: { headers: { 'last-event-id': cursor } },
          sseOptions: { maxEventSize: 1024 },
        })
        deepStrictEqual(yield* Effect.promise(() => queryClient.query(options)), {
          id: cursor,
          event: 'changed',
          data: 'next',
        })
        deepStrictEqual(queryClient.getQueryData(options.queryKey), {
          id: cursor,
          event: 'changed',
          data: 'next',
        })
      }
      const defaultKey = http.events.watch.liveKey(input)
      for (const sseOptions of [
        undefined,
        {},
        { maxEventSize: undefined },
        { maxEventSize: 10 * 1024 * 1024 },
      ]) {
        deepStrictEqual(defaultKey, http.events.watch.liveKey(input, { sseOptions }))
        deepStrictEqual(defaultKey, http.events.watch.liveOptions({ input, sseOptions }).queryKey)
        deepStrictEqual(
          http.events.undefined.liveKey(),
          http.events.undefined.liveOptions({ sseOptions }).queryKey,
        )
      }
      notDeepStrictEqual(
        defaultKey,
        http.events.watch.liveKey(input, { sseOptions: { maxEventSize: 1024 } }),
      )
      notDeepStrictEqual(defaultKey, http.events.watch.streamedKey(input))
      equal(Object.isFrozen(defaultKey.at(-1)), true)
      const skipped = http.events.watch.liveOptions({
        input: skipToken,
        sseOptions: { maxEventSize: 1024 },
        staleTime: 123,
      })
      equal(http.events.watch.liveOptions(skipToken).queryFn, skipToken)
      equal(skipped.queryFn, skipToken)
      equal(skipped.staleTime, 123)
      deepStrictEqual(skipped.queryKey, [...http.events.watch.key(), 'live'])
      for (const maxEventSize of [
        0,
        -1,
        0.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
        null,
        '2',
      ]) {
        const policy = { sseOptions: { maxEventSize } }
        for (const build of [
          () => Reflect.apply(http.events.watch.liveKey, undefined, [input, policy]),
          () => Reflect.apply(http.events.undefined.liveKey, undefined, [policy]),
          ...[input, skipToken].map(
            (request) => () =>
              Reflect.apply(http.events.watch.liveOptions, undefined, [
                { input: request, ...policy },
              ]),
          ),
        ]) {
          throws(build, (error: unknown) => {
            ok(error instanceof EffectHttpApiQueryConfigError)
            equal(error.code, 'InvalidMaxEventSize')
            return true
          })
        }
      }
      queryClient.setQueryData(
        http.events.watch.liveKey(input, { sseOptions: { maxEventSize: 1024 } }),
        4,
      )
      queryClient.setQueryData(http.events.watch.streamedKey(input), [3])
      equal(queryClient.getQueriesData({ queryKey: http.events.watch.key() }).length, 6)
      yield* Effect.promise(() =>
        queryClient.invalidateQueries({ queryKey: http.events.watch.key() }),
      )
      equal(queryClient.getQueryState(defaultKey)?.isInvalidated, true)
      equal(queryClient.getQueryState(http.events.watch.streamedKey(input))?.isInvalidated, true)
      equal(queryClient.getQueryState(http.events.wrapped.liveKey())?.isInvalidated, false)
    } finally {
      queryClient.clear()
    }
  }).pipe(Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)), Effect.scoped),
)

for (const [endpoint, firstChunk, lastChunk, firstValue, lastValue] of [
  ['nullable', 'null', '5', null, 5],
  ['nullable', '1', 'null', 1, null],
  ['mixedUndefined', '1', 'null', 1, null],
  ['mixedUndefined', 'null', '5', null, 5],
] as const) {
  let finish!: () => void
  let closed = 0
  const client = await makeClient(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${firstChunk}\n\n`))
            finish = () => {
              controller.enqueue(new TextEncoder().encode(`data: ${lastChunk}\n\n`))
              controller.close()
            }
          },
          cancel() {
            closed += 1
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  )
  const http = createHttpApiQueryUtils(api, {
    client,
    keyPrefix: ['visibility', endpoint, firstChunk],
  })
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryKeyHashFn: (key) => `custom:${JSON.stringify(key)}` },
    },
  })
  const options =
    endpoint === 'nullable'
      ? http.events.nullable.liveOptions()
      : http.events.mixedUndefined.liveOptions()
  const observer =
    endpoint === 'nullable'
      ? new QueryObserver(queryClient, http.events.nullable.liveOptions())
      : new QueryObserver(queryClient, http.events.mixedUndefined.liveOptions())
  const unsubscribe = observer.subscribe(() => undefined)
  try {
    await waitFor(
      queryClient,
      () =>
        observer.getCurrentResult().status === 'success' &&
        observer.getCurrentResult().data === firstValue,
    )
    equal(observer.getCurrentResult().fetchStatus, 'fetching')
    equal(queryClient.getQueryData(options.queryKey), firstValue)
    equal(queryClient.getQueryCache().getAll().length, 1)
    finish()
    await waitFor(queryClient, () => observer.getCurrentResult().fetchStatus === 'idle')
    equal(observer.getCurrentResult().data, lastValue)
    equal(queryClient.getQueryData(options.queryKey), lastValue)
    equal(closed, 0)
  } finally {
    unsubscribe()
    queryClient.clear()
  }
}

for (const [body, endpoint, headers, failureTag] of [
  ['data: "bad"\n\n', 'nullable', {}, 'SchemaError'],
  ['data: 1\n\n', 'wrapped', { 'x-version': 'bad' }, 'SchemaError'],
  ['id: v3\ndata: 1\n\nretry: 25\n\n', 'nullable', {}, 'Retry'],
] as const) {
  const client = await makeClient(() => sse(body, headers))
  const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['failure'] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    const pending =
      endpoint === 'wrapped'
        ? queryClient.query(http.events.wrapped.liveOptions())
        : queryClient.query(http.events.nullable.liveOptions())
    await rejects(
      pending,
      expectFailure(endpoint, (cause) => {
        deepStrictEqual(
          cause.reasons.map((reason) =>
            reason._tag === 'Fail' ? Reflect.get(reason.error as object, '_tag') : reason._tag,
          ),
          [failureTag],
        )
        if (failureTag === 'Retry') {
          const reason = cause.reasons[0]
          ok(reason?._tag === 'Fail')
          equal(Reflect.get(reason.error as object, 'lastEventId'), 'v3')
        }
      }),
    )
    if (failureTag === 'Retry') equal(queryClient.getQueryData(http.events.nullable.liveKey()), 1)
  } finally {
    queryClient.clear()
  }
}

{
  const client = await makeClient(
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
  const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['decoder'] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    equal(await queryClient.query(http.events.nullable.liveOptions()), 12345)
    await rejects(
      queryClient.query(http.events.nullable.liveOptions({ sseOptions: { maxEventSize: 3 } })),
      expectFailure('nullable', (cause) => {
        const reason = cause.reasons[0]
        ok(reason?._tag === 'Fail')
        equal(Reflect.get(reason.error as object, '_tag'), 'SseError')
      }),
    )
  } finally {
    queryClient.clear()
  }
}

for (const phase of ['acquisition', 'consumption', 'unsubscribe'] as const) {
  const started = Deferred.makeUnsafe<undefined>()
  const finalized = Deferred.makeUnsafe<undefined>()
  let closed = 0
  let signal: AbortSignal | undefined
  const client = await Effect.runPromise(
    HttpApiClient.makeWith(api, {
      baseUrl: 'https://example.test',
      httpClient: HttpClient.make((request, _url, transportSignal) => {
        signal = transportSignal
        if (phase === 'acquisition')
          return Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(finalized, undefined)),
          )
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
                  Effect.runSync(Deferred.succeed(finalized, undefined))
                },
              }),
              { headers: { 'content-type': 'text/event-stream' } },
            ),
          ),
        )
      }),
    }),
  )
  const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['cancel', phase] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const options = http.events.nullable.liveOptions()
  const observer = new QueryObserver(queryClient, options)
  const unsubscribe =
    phase === 'unsubscribe' ? observer.subscribe(() => undefined) : () => undefined
  const pending = phase === 'unsubscribe' ? undefined : queryClient.query(options)
  const outcome = pending?.catch((error: unknown) => error)
  try {
    if (phase === 'acquisition')
      await Effect.runPromise(Deferred.await(started).pipe(Effect.timeout('5 seconds')))
    else await waitFor(queryClient, () => queryClient.getQueryData(options.queryKey) === 1)
    if (phase === 'unsubscribe') unsubscribe()
    else await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true })
    await Effect.runPromise(Deferred.await(finalized).pipe(Effect.timeout('5 seconds')))
    equal(signal?.aborted, true)
    equal(closed, phase === 'acquisition' ? 0 : 1)
    const result = await outcome
    if (phase === 'acquisition') ok(isCancelledError(result))
    else if (phase === 'consumption') equal(result, 1)
    equal(queryClient.getQueryData(options.queryKey), phase === 'acquisition' ? undefined : 1)
    equal(queryClient.getQueryState(options.queryKey)?.fetchStatus, 'idle')
    equal(queryClient.getQueryState(options.queryKey)?.error, null)
  } finally {
    unsubscribe()
    queryClient.clear()
  }
}

{
  const cause = Cause.combine(Cause.interrupt(123), Cause.die(new Error('acquisition defect')))
  const client = await Effect.runPromise(
    HttpApiClient.makeWith(api, {
      baseUrl: 'https://example.test',
      httpClient: HttpClient.make(() => Effect.failCause(cause)),
    }),
  )
  const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['acquisition-failure'] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await rejects(
      queryClient.query(http.events.nullable.liveOptions()),
      expectFailure('nullable', (actual) => {
        deepStrictEqual(
          actual.reasons.map((reason) => reason._tag),
          ['Interrupt', 'Die'],
        )
        const defect = actual.reasons[1]
        ok(defect?._tag === 'Die')
        const original = cause.reasons[1]
        ok(original?._tag === 'Die')
        equal(defect.defect, original.defect)
      }),
    )
  } finally {
    queryClient.clear()
  }
}

class Scale extends Context.Service<Scale, { readonly factor: number }>()('HttpLive/Scale') {}
const Scaled = Schema.Finite.pipe(
  Schema.decodeTo(
    Schema.Finite,
    SchemaTransformation.transformEffect({
      decode: (value) => Scale.pipe(Effect.map(({ factor }) => value * factor)),
      encode: Effect.succeed,
    }),
  ),
)
const serviceApi = HttpApi.make('live-services').add(
  HttpApiGroup.make('events').add(
    HttpApiEndpoint.get('watch', '/watch', { success: HttpApiSchema.StreamSse({ data: Scaled }) }),
  ),
)
const serviceClient = await Effect.runPromise(
  HttpApiClient.makeWith(serviceApi, {
    baseUrl: 'https://example.test',
    httpClient: HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, sse('data: 3\n\n'))),
    ),
  }),
)
const serviceHttp = createHttpApiQueryUtils(serviceApi, {
  client: serviceClient,
  keyPrefix: ['services'],
  runPromiseExit: (effect, options) =>
    Effect.runPromiseExit(effect.pipe(Effect.provideService(Scale, { factor: 2 })), options),
})
const serviceQueryClient = new QueryClient()
try {
  equal(await serviceQueryClient.query(serviceHttp.events.watch.liveOptions()), 6)
} finally {
  serviceQueryClient.clear()
}

{
  const client = await makeClient(() => sse('data: 1\n\n'))
  const cause = Cause.combine(Cause.interrupt(123), Cause.die(new Error('defect')))
  const failedExit = Exit.failCause(cause)
  const failed = createHttpApiQueryUtils(api, {
    client,
    keyPrefix: ['runner-cause'],
    runPromiseExit: () => Promise.resolve(failedExit),
  })
  const rejection = new Error('runner rejected')
  const http = createHttpApiQueryUtils(api, {
    client,
    keyPrefix: ['runner-rejection'],
    runPromiseExit: () => Promise.reject<never>(rejection),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await rejects(
      queryClient.query(failed.events.nullable.liveOptions()),
      expectFailure('nullable', (actual) => equal(actual, cause)),
    )
    await rejects(
      queryClient.query(http.events.nullable.liveOptions()),
      (error) => error === rejection,
    )
  } finally {
    queryClient.clear()
  }
}
console.log('Packed HTTP live values, policies, failures, services, and resource cleanup executed')
