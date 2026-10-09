import { QueryClient, QueryObserver, skipToken } from '@tanstack/query-core'
import { Context, Effect, Schema, SchemaTransformation } from 'effect'
import type { Stream } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import type { EffectHttpApiQueryError, RunPromiseExit } from 'effect-api-query'
import type { Sse } from 'effect/encoding'
import type { HttpClientError } from 'effect/http'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import type { HttpApiClient } from 'effect/http-api'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

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
const Expired = Schema.TaggedStruct('Expired', { reason: Schema.String })
const Plain = HttpApiEndpoint.get('plain', '/plain/:id', {
  params: { id: Schema.FiniteFromString },
  success: HttpApiSchema.StreamSse({ data: Scaled, error: Expired }),
})
const Wrapped = HttpApiEndpoint.get('wrapped', '/wrapped', {
  success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamSse({ data: Schema.Finite }), {
    'x-version': Schema.FiniteFromString,
  }),
})
const Mixed = HttpApiEndpoint.get('mixed', '/mixed', {
  success: [
    HttpApiSchema.StreamSse({ data: Schema.Finite }),
    Schema.String.pipe(HttpApiSchema.status(201)),
  ],
})
const Bytes = HttpApiEndpoint.get('bytes', '/bytes', { success: HttpApiSchema.StreamUint8Array() })
const WrappedBytes = HttpApiEndpoint.get('wrappedBytes', '/wrapped-bytes', {
  success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamUint8Array(), { etag: Schema.String }),
})
const Multipart = HttpApiEndpoint.post('multipart', '/multipart', {
  payload: Schema.Struct({ name: Schema.String }).pipe(HttpApiSchema.asMultipart()),
  success: HttpApiSchema.StreamSse({ data: Schema.Finite }),
})
const Events = HttpApiEndpoint.get('events', '/events', {
  success: HttpApiSchema.StreamSse({
    events: Schema.Struct({
      id: Schema.String,
      event: Schema.Literal('changed'),
      data: Schema.String,
    }),
  }),
})
const api = HttpApi.make('stream-contract').add(
  HttpApiGroup.make('views').add(Plain, Wrapped, Mixed, Bytes, WrappedBytes, Multipart),
  HttpApiGroup.make('system', { topLevel: true }).add(Events),
  HttpApiGroup.make('omitted').add(Bytes),
)
declare const client: HttpApiClient.ForApi<typeof api, 'client-error', 'client-service'>
declare const runPromiseExit: RunPromiseExit<Scale | 'client-service'>
const utils = createHttpApiQueryUtils(api, { client, keyPrefix: ['consumer'], runPromiseExit })
true satisfies Assert<Equal<keyof typeof utils, 'key' | 'views' | 'events'>>
true satisfies Assert<Equal<keyof typeof utils.views, 'key' | 'plain' | 'wrapped'>>
true satisfies Assert<
  Equal<keyof typeof utils.views.plain, 'key' | 'streamedKey' | 'streamedOptions'>
>
const queryClient = new QueryClient()
const input = { params: { id: 1 } }
const options = utils.views.plain.streamedOptions({
  input,
  maxChunks: 3,
  refetchMode: 'append',
  sseOptions: { maxEventSize: 1024 },
  select: (values) => values.length,
  staleTime: Infinity,
})
const data = queryClient.getQueryData(options.queryKey)
true satisfies Assert<Equal<typeof data, readonly number[] | undefined>>
const state = queryClient.getQueryState(options.queryKey)
type Error = EffectHttpApiQueryError<
  | 'client-error'
  | typeof Expired.Type
  | HttpClientError.HttpClientError
  | Schema.SchemaError
  | Sse.Retry
  | Sse.SseError
>
true satisfies Assert<Equal<NonNullable<typeof state>['error'], Error | null>>
const observer = new QueryObserver(queryClient, options)
true satisfies Assert<
  Equal<ReturnType<typeof observer.getCurrentResult>['data'], number | undefined>
>
const key = utils.views.plain.streamedKey(input, {
  maxChunks: 3,
  sseOptions: { maxEventSize: 1024 },
})
queryClient.setQueryData(key, [1, 2])
const skipped = utils.views.plain.streamedOptions({
  input: skipToken,
  sseOptions: { maxEventSize: 1024 },
  maxChunks: 2,
})
skipped.queryFn satisfies typeof skipToken
const conditional = utils.views.plain.streamedOptions({
  input: Math.random() > 0.5 ? input : skipToken,
})
new QueryObserver(queryClient, conditional)
const initial = utils.views.plain.streamedOptions({
  input,
  initialData: [1],
  select: (values) => values.length,
})
const wrapped = queryClient.getQueryData(
  utils.views.wrapped.streamedKey({ refetchMode: 'replace' }),
)
true satisfies Assert<
  Equal<
    typeof wrapped,
    readonly HttpApiSchema.withHeaders<number, { readonly 'x-version': number }>[] | undefined
  >
>
const events = queryClient.getQueryData(utils.events.streamedKey())
true satisfies Assert<
  Equal<
    typeof events,
    readonly { readonly id: string; readonly event: 'changed'; readonly data: string }[] | undefined
  >
>
const captured = { params: { id: 1 }, sseOptions: { maxEventSize: 1024 } }
// @ts-expect-error Decoder controls remain separate from request input.
utils.views.plain.streamedKey(captured)
// @ts-expect-error The adapter owns response mode.
utils.views.plain.streamedOptions({ input: { ...input, responseMode: 'response-only' } })
// @ts-expect-error SSE endpoints expose accumulated query builders.
utils.views.plain.queryOptions({ input })
// @ts-expect-error SSE endpoints expose accumulated query builders.
utils.views.plain.mutationOptions()
// @ts-expect-error Inputless endpoints do not accept skipToken.
utils.views.wrapped.streamedOptions({ input: skipToken })
// @ts-expect-error Caller hashes belong in QueryClient defaults.
utils.views.plain.streamedOptions({ input, queryHash: 'shared' })
// @ts-expect-error The acquisition decoding services require a runner.
createHttpApiQueryUtils(api, { client, keyPrefix: ['missing'] })
const custom = createHttpApiQueryUtils(api, {
  client,
  keyPrefix: ['custom'],
  runPromiseExit,
  keyEncoders: { views: { plain: (request) => request.params.id } },
})
custom.views.plain.streamedKey(input)
initial.queryKey satisfies typeof key

declare const extraStream: Stream.Stream<number, 'stream-error', 'stream-service'>
declare const extraClient: HttpApiClient.ForApi<typeof api> & {
  readonly views: {
    readonly plain: (request: {
      readonly params: { readonly id: number }
      readonly responseMode: 'decoded-only'
    }) => Effect.Effect<typeof extraStream, 'extra-error', Scale | 'stream-service'>
  }
}
declare const extraRunner: RunPromiseExit<Scale | 'stream-service'>
const extra = createHttpApiQueryUtils(api, {
  client: extraClient,
  keyPrefix: ['extra'],
  runPromiseExit: extraRunner,
})
queryClient.getQueryData(extra.views.plain.streamedKey(input)) satisfies
  | readonly number[]
  | undefined

const extraState = queryClient.getQueryState(extra.views.plain.streamedKey(input))
type ExtraFailure = NonNullable<typeof extraState>['error'] extends EffectHttpApiQueryError<
  infer E
> | null
  ? E
  : never
true satisfies Assert<
  Equal<Extract<ExtraFailure, 'extra-error' | 'stream-error'>, 'extra-error' | 'stream-error'>
>
createHttpApiQueryUtils(api, {
  client: extraClient,
  keyPrefix: ['extra'],
  // @ts-expect-error Additional acquisition and consumption requirements remain caller-owned.
  runPromiseExit: Effect.runPromiseExit,
})
