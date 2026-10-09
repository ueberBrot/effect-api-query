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
const api = HttpApi.make('http-streams').add(
  HttpApiGroup.make('events').add(
    HttpApiEndpoint.get('watch', '/watch', {
      query: { channel: Schema.String },
      success: HttpApiSchema.StreamSse({ data: Schema.Finite, error: Expired }),
    }),
    HttpApiEndpoint.get('cursor', '/cursor', {
      headers: { 'last-event-id': Schema.String },
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
    }),
    HttpApiEndpoint.get('wrapped', '/wrapped', {
      success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamSse({ data: Schema.Finite }), {
        'x-version': Schema.FiniteFromString,
      }),
    }),
    HttpApiEndpoint.get('undefined', '/undefined', {
      success: HttpApiSchema.StreamSse({ data: UndefinedValue }),
    }),
    HttpApiEndpoint.get('plain', '/plain', {
      success: HttpApiSchema.StreamSse({ data: Schema.Finite }),
    }),
    HttpApiEndpoint.get('records', '/records', {
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
              : Stream.make(1, 2, 3, 4),
      ),
    )
    .handle('cursor', ({ headers }) => Effect.succeed(Stream.succeed(headers['last-event-id'])))
    .handle('undefined', () => Effect.succeed(Stream.make(undefined, undefined)))
    .handle('wrapped', () =>
      Effect.succeed(
        HttpApiSchema.withHeaders({ body: Stream.make(3, 7), headers: { 'x-version': 4 } }),
      ),
    )
    .handle('plain', () => Effect.succeed(Stream.empty))
    .handle('records', () =>
      Effect.succeed(Stream.make({ id: 'v1', event: 'changed', data: 'first' })),
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
const makeClient = (response: () => Response) =>
  Effect.runPromise(
    HttpApiClient.makeWith(api, {
      baseUrl: 'https://example.test',
      httpClient: HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, response())),
      ),
    }),
  )
const sse = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { 'content-type': 'text/event-stream', ...headers } })
const expectFailure =
  (endpoint: string, check: (cause: Cause.Cause<unknown>) => void) => (error: unknown) => {
    ok(error instanceof EffectHttpApiQueryError)
    equal(error.apiId, 'http-streams')
    equal(error.groupId, 'events')
    equal(error.endpoint, endpoint)
    equal(error.method, 'GET')
    equal(error.operation, 'streamed')
    check(error.cause)
    return true
  }

await Effect.runPromise(
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(api, ['events'])
    const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['consumer'] })
    const input = { query: { channel: 'news' } }
    const queryClient = new QueryClient()
    try {
      const options = utils.events.watch.streamedOptions({ input })
      deepStrictEqual(yield* Effect.promise(() => queryClient.query(options)), [1, 2, 3, 4])
      deepStrictEqual(queryClient.getQueryData(options.queryKey), [1, 2, 3, 4])
      deepStrictEqual(
        yield* Effect.promise(() =>
          queryClient.query(utils.events.watch.streamedOptions({ input, maxChunks: 2 })),
        ),
        [3, 4],
      )
      equal(queryClient.getQueryCache().getAll().length, 2)
      for (const cursor of ['v1', 'v2']) {
        const cursorOptions = utils.events.cursor.streamedOptions({
          input: { headers: { 'last-event-id': cursor } },
          sseOptions: { maxEventSize: 1024 },
        })
        deepStrictEqual(yield* Effect.promise(() => queryClient.query(cursorOptions)), [cursor])
        deepStrictEqual(
          queryClient.getQueryData(
            utils.events.cursor.streamedKey(
              { headers: { 'last-event-id': cursor } },
              { sseOptions: { maxEventSize: 1024 } },
            ),
          ),
          [cursor],
        )
      }
      deepStrictEqual(
        yield* Effect.promise(() => queryClient.query(utils.events.wrapped.streamedOptions())),
        [
          HttpApiSchema.withHeaders({ body: 3, headers: { 'x-version': 4 } }),
          HttpApiSchema.withHeaders({ body: 7, headers: { 'x-version': 4 } }),
        ],
      )
      deepStrictEqual(
        yield* Effect.promise(() => queryClient.query(utils.events.records.streamedOptions())),
        [{ id: 'v1', event: 'changed', data: 'first' }],
      )
      deepStrictEqual(
        yield* Effect.promise(() => queryClient.query(utils.events.plain.streamedOptions())),
        [],
      )
      const defaultKey = utils.events.watch.streamedKey(input)
      for (const sseOptions of [
        undefined,
        {},
        { maxEventSize: undefined },
        { maxEventSize: 10 * 1024 * 1024 },
      ]) {
        deepStrictEqual(
          defaultKey,
          utils.events.watch.streamedKey(input, {
            sseOptions,
            maxChunks: undefined,
            refetchMode: 'reset',
          }),
        )
        deepStrictEqual(
          defaultKey,
          utils.events.watch.streamedOptions({ input, sseOptions }).queryKey,
        )
      }
      notDeepStrictEqual(
        defaultKey,
        utils.events.watch.streamedKey(input, { sseOptions: { maxEventSize: 1024 } }),
      )
      notDeepStrictEqual(
        defaultKey,
        utils.events.watch.streamedKey(input, { refetchMode: 'append' }),
      )
      equal(Object.isFrozen(defaultKey), true)
      equal(Object.isFrozen(defaultKey.at(-1)), true)
      for (const refetchMode of ['reset', 'append', 'replace'] as const) {
        for (const maxChunks of [undefined, 2]) {
          deepStrictEqual(
            utils.events.watch.streamedKey(input, { refetchMode, maxChunks }),
            utils.events.watch.streamedOptions({ input, refetchMode, maxChunks }).queryKey,
          )
          deepStrictEqual(
            utils.events.plain.streamedKey({ refetchMode, maxChunks }),
            utils.events.plain.streamedOptions({ refetchMode, maxChunks }).queryKey,
          )
        }
      }
      const skipped = utils.events.watch.streamedOptions({
        input: skipToken,
        maxChunks: 2,
        sseOptions: { maxEventSize: 1024 },
        staleTime: 123,
      })
      equal(skipped.queryFn, skipToken)
      equal(skipped.staleTime, 123)
      deepStrictEqual(skipped.queryKey, [...utils.events.watch.key(), 'streamed'])
      for (const [policy, code] of [
        ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null].map(
          (maxChunks) => [{ maxChunks }, 'InvalidMaxChunks'] as const,
        ),
        ...['unknown', null, 3].map(
          (refetchMode) => [{ refetchMode }, 'InvalidRefetchMode'] as const,
        ),
        ...[0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null].map(
          (maxEventSize) => [{ sseOptions: { maxEventSize } }, 'InvalidMaxEventSize'] as const,
        ),
      ]) {
        for (const build of [
          () => Reflect.apply(utils.events.watch.streamedKey, undefined, [input, policy]),
          () => Reflect.apply(utils.events.plain.streamedKey, undefined, [policy]),
          ...[input, skipToken].map(
            (request) => () =>
              Reflect.apply(utils.events.watch.streamedOptions, undefined, [
                { input: request, ...policy },
              ]),
          ),
        ]) {
          throws(build, (error: unknown) => {
            ok(error instanceof EffectHttpApiQueryConfigError)
            equal(error.code, code)
            equal(error.apiId, 'http-streams')
            return true
          })
        }
      }
      equal(queryClient.getQueriesData({ queryKey: utils.events.watch.key() }).length, 2)
      yield* Effect.promise(() =>
        queryClient.invalidateQueries({ queryKey: utils.events.watch.key() }),
      )
      equal(queryClient.getQueryState(options.queryKey)?.isInvalidated, true)
      equal(queryClient.getQueryState(utils.events.wrapped.streamedKey())?.isInvalidated, false)
    } finally {
      queryClient.clear()
    }
  }).pipe(Effect.provide(Layer.mergeAll(handlers, HttpServer.layerServices)), Effect.scoped),
)

for (const refetchMode of ['reset', 'append', 'replace'] as const) {
  for (const maxChunks of [undefined, 2]) {
    let body = 'data: 1\n\ndata: 2\n\ndata: 3\n\n'
    const client = await makeClient(() => sse(body))
    const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['refetch'] })
    const queryClient = new QueryClient()
    const options = utils.events.plain.streamedOptions({
      refetchMode,
      maxChunks,
      initialData: [99],
    })
    try {
      deepStrictEqual(await queryClient.query(options), maxChunks === 2 ? [2, 3] : [99, 1, 2, 3])
      body = 'data: 4\n\ndata: 5\n\n'
      deepStrictEqual(
        await queryClient.query(options),
        refetchMode === 'append' && maxChunks === undefined ? [99, 1, 2, 3, 4, 5] : [4, 5],
      )
      body = ''
      deepStrictEqual(
        await queryClient.query(options),
        refetchMode === 'append' ? (maxChunks === undefined ? [99, 1, 2, 3, 4, 5] : [4, 5]) : [],
      )
    } finally {
      queryClient.clear()
    }
  }
}

for (const [body, endpoint, headers, failureTag] of [
  ['data: "bad"\n\n', 'plain', {}, 'SchemaError'],
  ['data: 1\n\n', 'wrapped', { 'x-version': 'bad' }, 'SchemaError'],
  ['id: v3\ndata: 1\n\nretry: 25\n\n', 'plain', {}, 'Retry'],
] as const) {
  const client = await makeClient(() => sse(body, headers))
  const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['failures'] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    const options =
      endpoint === 'wrapped'
        ? utils.events.wrapped.streamedOptions()
        : utils.events.plain.streamedOptions()
    const pending =
      endpoint === 'wrapped'
        ? queryClient.query(utils.events.wrapped.streamedOptions())
        : queryClient.query(utils.events.plain.streamedOptions())
    await rejects(
      pending,
      expectFailure(endpoint, (cause) =>
        deepStrictEqual(
          cause.reasons.map((reason) =>
            reason._tag === 'Fail' ? Reflect.get(reason.error as object, '_tag') : reason._tag,
          ),
          [failureTag],
        ),
      ),
    )
    if (failureTag === 'Retry') deepStrictEqual(queryClient.getQueryData(options.queryKey), [1])
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
  const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['decoder'] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    deepStrictEqual(await queryClient.query(utils.events.plain.streamedOptions()), [12345])
    await rejects(
      queryClient.query(utils.events.plain.streamedOptions({ sseOptions: { maxEventSize: 3 } })),
      expectFailure('plain', (cause) =>
        equal(
          cause.reasons[0]?._tag === 'Fail' &&
            Reflect.get(cause.reasons[0].error as object, '_tag'),
          'SseError',
        ),
      ),
    )
  } finally {
    queryClient.clear()
  }
}

for (const phase of ['acquisition', 'consumption'] as const) {
  const cause = Cause.combine(Cause.interrupt(123), Cause.die(new Error('defect')))
  const client = await Effect.runPromise(
    HttpApiClient.makeWith(api, {
      baseUrl: 'https://example.test',
      httpClient: HttpClient.make((request) =>
        phase === 'acquisition'
          ? Effect.failCause(cause)
          : Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  new ReadableStream<Uint8Array>({
                    start(controller) {
                      controller.error(new Error('transport'))
                    },
                  }),
                  { headers: { 'content-type': 'text/event-stream' } },
                ),
              ),
            ),
      ),
    }),
  )
  const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['cause'] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await rejects(
      queryClient.query(utils.events.plain.streamedOptions()),
      expectFailure('plain', (actual) =>
        phase === 'acquisition'
          ? deepStrictEqual(
              actual.reasons.map((reason) => reason._tag),
              ['Interrupt', 'Die'],
            )
          : ok(Cause.hasFails(actual)),
      ),
    )
  } finally {
    queryClient.clear()
  }
}

for (const cancelPhase of ['acquisition', 'consumption'] as const) {
  let closed = 0
  let signal: AbortSignal | undefined
  const started = Deferred.makeUnsafe<undefined>()
  const finalized = Deferred.makeUnsafe<undefined>()
  const client = await Effect.runPromise(
    HttpApiClient.makeWith(api, {
      baseUrl: 'https://example.test',
      httpClient: HttpClient.make((request, _url, transportSignal) => {
        signal = transportSignal
        if (cancelPhase === 'acquisition')
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
  const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['cancel'] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const options = utils.events.plain.streamedOptions()
  const pending = queryClient.query(options)
  const outcome = pending.catch((error: unknown) => error)
  try {
    if (cancelPhase === 'acquisition')
      await Effect.runPromise(Deferred.await(started).pipe(Effect.timeout('5 seconds')))
    else await waitFor(queryClient, () => queryClient.getQueryData(options.queryKey)?.length === 1)
    await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true })
    const result = await outcome
    if (cancelPhase === 'acquisition') ok(isCancelledError(result))
    else deepStrictEqual(result, [1])
    await Effect.runPromise(Deferred.await(finalized).pipe(Effect.timeout('5 seconds')))
    equal(signal?.aborted, true)
    equal(closed, cancelPhase === 'consumption' ? 1 : 0)
    deepStrictEqual(
      queryClient.getQueryData(options.queryKey),
      cancelPhase === 'acquisition' ? undefined : [1],
    )
  } finally {
    queryClient.clear()
  }
}

{
  let closed = 0
  const finalized = Deferred.makeUnsafe<undefined>()
  const client = await makeClient(
    () =>
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
  )
  const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['observer'] })
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryKeyHashFn: (key) => `custom:${JSON.stringify(key)}`, retry: false },
    },
  })
  const observer = new QueryObserver(queryClient, utils.events.plain.streamedOptions())
  const unsubscribe = observer.subscribe(() => undefined)
  try {
    await waitFor(queryClient, () => observer.getCurrentResult().data?.length === 1)
    equal(observer.getCurrentResult().status, 'success')
    equal(observer.getCurrentResult().fetchStatus, 'fetching')
    deepStrictEqual(queryClient.getQueryData(utils.events.plain.streamedKey()), [1])
    equal(queryClient.getQueryCache().getAll().length, 1)
    unsubscribe()
    await Effect.runPromise(Deferred.await(finalized).pipe(Effect.timeout('5 seconds')))
    equal(closed, 1)
  } finally {
    unsubscribe()
    queryClient.clear()
  }
}

class Scale extends Context.Service<Scale, { readonly factor: number }>()('HttpStream/Scale') {}
const Scaled = Schema.Finite.pipe(
  Schema.decodeTo(
    Schema.Finite,
    SchemaTransformation.transformEffect({
      decode: (value) => Scale.pipe(Effect.map(({ factor }) => value * factor)),
      encode: Effect.succeed,
    }),
  ),
)
const serviceApi = HttpApi.make('services').add(
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
const serviceUtils = createHttpApiQueryUtils(serviceApi, {
  client: serviceClient,
  keyPrefix: ['services'],
  runPromiseExit: (effect, options) =>
    Effect.runPromiseExit(effect.pipe(Effect.provideService(Scale, { factor: 2 })), options),
})
const serviceQueryClient = new QueryClient()
try {
  deepStrictEqual(await serviceQueryClient.query(serviceUtils.events.watch.streamedOptions()), [6])
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
  const utils = createHttpApiQueryUtils(api, {
    client,
    keyPrefix: ['runner'],
    runPromiseExit: () => Promise.reject<never>(rejection),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    await rejects(
      queryClient.query(failed.events.plain.streamedOptions()),
      expectFailure('plain', (actual) => equal(actual, cause)),
    )
    await rejects(
      queryClient.query(utils.events.plain.streamedOptions()),
      (error) => error === rejection,
    )
  } finally {
    queryClient.clear()
  }
}
