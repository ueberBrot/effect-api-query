import { it } from '@effect/vitest'
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
import { describe, expect } from 'vite-plus/test'

class Scale extends Context.Service<Scale, { readonly factor: number }>()('HttpViewProof/Scale') {}
const Scaled = Schema.Finite.pipe(
  Schema.decodeTo(
    Schema.Finite,
    SchemaTransformation.transformEffect({
      decode: (value) => Scale.pipe(Effect.map(({ factor }) => value * factor)),
      encode: (value) => Effect.succeed(value),
    }),
  ),
)
const Expired = Schema.TaggedStruct('Expired', { reason: Schema.String })
const Event = Schema.Struct({
  id: Schema.optional(Schema.String),
  event: Schema.Literal('changed'),
  data: Schema.fromJsonString(Schema.Finite),
})

const Api = HttpApi.make('http-view-proof').add(
  HttpApiGroup.make('views').add(
    HttpApiEndpoint.get('wrapped', '/wrapped', {
      success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamSse({ data: Schema.Finite }), {
        'x-version': Schema.FiniteFromString,
      }),
    }),
    HttpApiEndpoint.get('buffered', '/buffered', {
      success: HttpApiSchema.WithHeaders(Schema.FiniteFromString, {
        'x-version': Schema.FiniteFromString,
      }).pipe(HttpApiSchema.status(203)),
    }),
    HttpApiEndpoint.get('plain', '/plain', {
      success: HttpApiSchema.StreamSse({ data: Schema.Finite }),
    }),
    HttpApiEndpoint.get('events', '/events', {
      success: HttpApiSchema.StreamSse({ events: Event }),
    }),
    HttpApiEndpoint.get('serviceful', '/serviceful', {
      success: HttpApiSchema.StreamSse({ data: Scaled }),
    }),
    HttpApiEndpoint.get('failure', '/failure', {
      success: HttpApiSchema.StreamSse({ data: Schema.Finite, error: Expired }),
    }),
    HttpApiEndpoint.get('bytes', '/bytes', { success: HttpApiSchema.StreamUint8Array() }),
  ),
)

const Handlers = HttpApiBuilder.group(Api, 'views', (handlers) =>
  handlers
    .handle('wrapped', () =>
      Effect.succeed(
        HttpApiSchema.withHeaders({ body: Stream.make(3, 7), headers: { 'x-version': 4 } }),
      ),
    )
    .handle('buffered', () =>
      Effect.succeed(HttpApiSchema.withHeaders({ body: 42, headers: { 'x-version': 4 } })),
    )
    .handle('plain', () => Effect.succeed(Stream.make(3, 7)))
    .handle('events', () => Effect.succeed(Stream.make({ id: 'v3', event: 'changed', data: 3 })))
    .handle('serviceful', () => Effect.succeed(Stream.make(3, 7)))
    .handle('failure', () =>
      Effect.succeed(
        Stream.concat(
          Stream.succeed(3),
          Stream.fail({ _tag: 'Expired', reason: 'resume required' }),
        ),
      ),
    )
    .handle('bytes', () =>
      Effect.succeed(Stream.make(new Uint8Array([1, 2]), new Uint8Array([3]))),
    ),
)
const TestLayer = Layer.mergeAll(Handlers, HttpServer.layerServices)
const makeWireClient = (response: () => Response) =>
  HttpApiClient.makeWith(Api, {
    baseUrl: 'https://example.test',
    httpClient: HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, response())),
    ),
  })

const sseResponse = (body: string) =>
  new Response(body, { headers: { 'content-type': 'text/event-stream' } })
const sseSegments = (...parts: readonly string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(new TextEncoder().encode(part))
        }
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )

describe('HTTP view design proof through public Effect clients', () => {
  it.effect(
    'projects decoded response headers onto every emitted value without caching a Stream',
    () =>
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(Api, ['views'])
        const response = yield* client.views.wrapped({ responseMode: 'decoded-only' })
        const values = yield* response.body.pipe(
          Stream.map((body) => HttpApiSchema.withHeaders({ body, headers: response.headers })),
          Stream.runCollect,
        )
        expect(values).toStrictEqual([
          HttpApiSchema.withHeaders({ body: 3, headers: { 'x-version': 4 } }),
          HttpApiSchema.withHeaders({ body: 7, headers: { 'x-version': 4 } }),
        ])
      }).pipe(Effect.provide(TestLayer), Effect.scoped),
  )

  it.effect('buffers metadata while preserving the declared decoded WithHeaders value', () =>
    Effect.gen(function* () {
      const client = yield* HttpApiClient.makeWith(Api, {
        baseUrl: 'https://example.test',
        httpClient: HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json('42', {
                status: 203,
                headers: { 'x-version': '4', etag: 'revision-4' },
              }),
            ),
          ),
        ),
      })
      const [data, response] = yield* client.views.buffered({
        responseMode: 'decoded-and-response',
      })
      const view = Object.freeze({
        data,
        status: response.status,
        headers: Object.freeze({ ...response.headers }),
      })
      expect(view.data).toStrictEqual(
        HttpApiSchema.withHeaders({ body: 42, headers: { 'x-version': 4 } }),
      )
      expect(view.status).toBe(203)
      expect(view.headers).toMatchObject({ etag: 'revision-4', 'x-version': '4' })
      expect(Object.getPrototypeOf(view.headers)).toBe(Object.prototype)
      expect(Object.isFrozen(view.headers)).toBe(true)
    }),
  )

  it.effect(
    'preserves declared event fields while data-mode declarations emit only decoded data',
    () =>
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(Api, ['views'])
        const plain = yield* client.views.plain({ responseMode: 'decoded-only' })
        const events = yield* client.views.events({ responseMode: 'decoded-only' })
        expect(yield* Stream.runCollect(plain)).toStrictEqual([3, 7])
        expect(yield* Stream.runCollect(events)).toStrictEqual([
          { id: 'v3', event: 'changed', data: 3 },
        ])
      }).pipe(Effect.provide(TestLayer), Effect.scoped),
  )

  it.effect(
    'captures decoding services during acquisition for later service-free consumption',
    () =>
      Effect.gen(function* () {
        const client = yield* makeWireClient(() => sseResponse('data: 3\n\n'))
        const stream = yield* client.views
          .serviceful({ responseMode: 'decoded-only' })
          .pipe(Effect.provideService(Scale, { factor: 2 }))
        expect(yield* Stream.runCollect(stream)).toStrictEqual([6])
      }),
  )

  it.effect('limits pending SSE event text during consumption without changing acquisition', () =>
    Effect.gen(function* () {
      const client = yield* makeWireClient(() => sseSegments('data: 12345', '\n\n'))
      const accepted = yield* client.views.plain({ responseMode: 'decoded-only' })
      expect(yield* Stream.runCollect(accepted)).toStrictEqual([12_345])
      const limited = yield* client.views.plain({
        responseMode: 'decoded-only',
        sseOptions: { maxEventSize: 3 },
      })
      const failure = yield* Effect.exit(Stream.runCollect(limited))
      expect(failure).toMatchObject({
        cause: {
          reasons: [
            {
              _tag: 'Fail',
              error: { _tag: 'SseError', reason: { _tag: 'EventTooLarge', maxEventSize: 3 } },
            },
          ],
        },
      })
    }),
  )

  it.effect(
    'fails malformed decoded headers at acquisition and malformed SSE data at consumption',
    () =>
      Effect.gen(function* () {
        const client = yield* makeWireClient(
          () =>
            new Response('data: "invalid"\n\n', {
              headers: { 'content-type': 'text/event-stream', 'x-version': 'invalid' },
            }),
        )
        const headersFailure = yield* Effect.exit(
          client.views.wrapped({ responseMode: 'decoded-only' }),
        )
        expect(headersFailure).toMatchObject({
          cause: { reasons: [{ _tag: 'Fail', error: { _tag: 'SchemaError' } }] },
        })
        const acquired = yield* client.views.plain({ responseMode: 'decoded-only' })
        const streamFailure = yield* Effect.exit(Stream.runCollect(acquired))
        expect(streamFailure).toMatchObject({
          cause: { reasons: [{ _tag: 'Fail', error: { _tag: 'SchemaError' } }] },
        })
      }),
  )

  it.effect('preserves successful chunks before a declared reserved-event stream failure', () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(Api, ['views'])
      const stream = yield* client.views.failure({ responseMode: 'decoded-only' })
      const values: number[] = []
      const failure = yield* Effect.exit(
        stream.pipe(Stream.runForEach((value) => Effect.sync(() => values.push(value)))),
      )
      expect(values).toStrictEqual([3])
      expect(failure).toMatchObject({
        cause: {
          reasons: [{ _tag: 'Fail', error: { _tag: 'Expired', reason: 'resume required' } }],
        },
      })
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  )

  it.effect(
    'returns retry directives and resume cursors as failures for caller-owned reconnection',
    () =>
      Effect.gen(function* () {
        const client = yield* makeWireClient(() => sseResponse('id: v3\ndata: 3\n\nretry: 25\n\n'))
        const stream = yield* client.views.plain({ responseMode: 'decoded-only' })
        const values: number[] = []
        const failure = yield* Effect.exit(
          stream.pipe(Stream.runForEach((value) => Effect.sync(() => values.push(value)))),
        )
        expect(values).toStrictEqual([3])
        expect(failure).toMatchObject({
          cause: { reasons: [{ _tag: 'Fail', error: { _tag: 'Retry', lastEventId: 'v3' } }] },
        })
      }),
  )

  it.each(['iterator return', 'abort'] as const)(
    'finalizes an acquired SSE body on %s',
    async (mode) => {
      let closed = 0
      let transportSignal: AbortSignal | undefined
      const client = await Effect.runPromise(
        HttpApiClient.makeWith(Api, {
          baseUrl: 'https://example.test',
          httpClient: HttpClient.make((request, _url, signal) => {
            transportSignal = signal
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  new ReadableStream<Uint8Array>({
                    start(controller) {
                      controller.enqueue(new TextEncoder().encode('data: 3\n\n'))
                    },
                    cancel() {
                      closed += 1
                    },
                  }),
                  { headers: { 'content-type': 'text/event-stream' } },
                ),
              ),
            )
          }),
        }),
      )
      const stream = await Effect.runPromise(client.views.plain({ responseMode: 'decoded-only' }))
      let firstValue: number | undefined
      let interrupted = false
      if (mode === 'iterator return') {
        const iterator = Stream.toAsyncIterable(stream)[Symbol.asyncIterator]()
        try {
          const first = await iterator.next()
          firstValue = first.done === true ? undefined : first.value
        } finally {
          await iterator.return?.()
        }
      } else {
        const emitted = Deferred.makeUnsafe<undefined>()
        const controller = new AbortController()
        const pending = Effect.runPromiseExit(
          stream.pipe(
            Stream.runForEach((value) =>
              Effect.sync(() => {
                firstValue = value
              }).pipe(Effect.andThen(Deferred.succeed(emitted, undefined))),
            ),
          ),
          { signal: controller.signal },
        )
        await Effect.runPromise(Deferred.await(emitted))
        controller.abort()
        const exit = await pending
        interrupted = Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
      }
      expect(firstValue).toBe(3)
      expect(interrupted).toBe(mode === 'abort')
      expect(transportSignal?.aborted).toBe(true)
      expect(closed).toBe(1)
    },
  )

  it.effect('distinguishes empty SSE completion from missing chunks and transport failures', () =>
    Effect.gen(function* () {
      const client = yield* makeWireClient(() => sseResponse(''))
      const stream = yield* client.views.plain({ responseMode: 'decoded-only' })
      expect(yield* Stream.runCollect(stream)).toStrictEqual([])
    }),
  )

  it.effect('exposes transport byte partitions rather than stable cache records', () =>
    Effect.gen(function* () {
      const whole = yield* makeWireClient(
        () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'application/octet-stream' },
          }),
      )
      const divided = yield* HttpApiTest.groups(Api, ['views'])
      const wholeStream = yield* whole.views.bytes({ responseMode: 'decoded-only' })
      const dividedStream = yield* divided.views.bytes({ responseMode: 'decoded-only' })
      const wholeChunks = yield* Stream.runCollect(wholeStream)
      const dividedChunks = yield* Stream.runCollect(dividedStream)
      expect(wholeChunks).toStrictEqual([new Uint8Array([1, 2, 3])])
      expect(dividedChunks).toStrictEqual([new Uint8Array([1, 2]), new Uint8Array([3])])
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  )
})
