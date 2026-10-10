import { QueryClient, QueryObserver, skipToken } from '@tanstack/query-core'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Context, Effect, Schema, SchemaTransformation } from 'effect'
import type { Stream } from 'effect'
import { createHttpApiQueryUtils, EffectHttpApiQueryEmptyStreamError } from 'effect-api-query'
import type {
  CreateHttpApiQueryUtilsOptions,
  EffectHttpApiQueryError,
  RunPromiseExit,
} from 'effect-api-query'
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
  Equal<
    keyof typeof utils.views.plain,
    'key' | 'streamedKey' | 'streamedOptions' | 'liveKey' | 'liveOptions'
  >
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
type ExtraRequirements = CreateHttpApiQueryUtilsOptions<
  typeof api,
  readonly ['extra'],
  typeof extraClient
>['runPromiseExit']
true satisfies Assert<Equal<ExtraRequirements, typeof extraRunner>>
true satisfies Assert<RunPromiseExit extends ExtraRequirements ? false : true>

const liveOptions = utils.views.plain.liveOptions({
  input,
  sseOptions: { maxEventSize: 1024 },
  select: (value) => value.toFixed(2),
  staleTime: Infinity,
})
const liveKey = utils.views.plain.liveKey(input, { sseOptions: { maxEventSize: 1024 } })
const liveData = queryClient.getQueryData(liveKey)
true satisfies Assert<Equal<typeof liveData, number | undefined>>
const liveState = queryClient.getQueryState(liveOptions.queryKey)
true satisfies Assert<
  Equal<NonNullable<typeof liveState>['error'], Error | EffectHttpApiQueryEmptyStreamError | null>
>
const liveObserver = new QueryObserver(queryClient, liveOptions)
true satisfies Assert<
  Equal<ReturnType<typeof liveObserver.getCurrentResult>['data'], string | undefined>
>
const liveSkipped = utils.views.plain.liveOptions({
  input: skipToken,
  sseOptions: { maxEventSize: 1024 },
  initialData: 1,
})
liveSkipped.queryFn satisfies typeof skipToken
utils.views.plain.liveOptions(skipToken).queryFn satisfies typeof skipToken
const liveConditional = utils.views.plain.liveOptions({
  input: Math.random() > 0.5 ? input : skipToken,
  initialData: () => 1,
  select: (value) => value.toString(),
})
const liveDefined = useQuery(
  utils.views.plain.liveOptions({ input, initialData: 1, select: (value) => value.toString() }),
)
true satisfies Assert<Equal<typeof liveDefined.data, string>>
const optionalNumber: number | undefined = Math.random() > 0.5 ? 1 : undefined
const liveOptional = useQuery(
  utils.views.plain.liveOptions({
    input,
    initialData: optionalNumber,
    select: (value) => value.toString(),
  }),
)
true satisfies Assert<Equal<typeof liveOptional.data, string | undefined>>
const liveSkippedResult = useQuery(liveSkipped)
true satisfies Assert<Equal<typeof liveSkippedResult.data, number | undefined>>
useQuery(liveConditional)
// @ts-expect-error Skipped live queries cannot guarantee suspense execution.
useSuspenseQuery(liveSkipped)
const liveWrapped = queryClient.getQueryData(utils.views.wrapped.liveKey())
true satisfies Assert<
  Equal<
    typeof liveWrapped,
    HttpApiSchema.withHeaders<number, { readonly 'x-version': number }> | undefined
  >
>
const liveEvents = queryClient.getQueryData(utils.events.liveKey())
true satisfies Assert<
  Equal<
    typeof liveEvents,
    { readonly id: string; readonly event: 'changed'; readonly data: string } | undefined
  >
>
const extraLiveState = queryClient.getQueryState(extra.views.plain.liveKey(input))
type ExtraLiveFailure =
  Exclude<
    NonNullable<typeof extraLiveState>['error'],
    EffectHttpApiQueryEmptyStreamError | null
  > extends EffectHttpApiQueryError<infer E>
    ? E
    : never
true satisfies Assert<
  Equal<Extract<ExtraLiveFailure, 'extra-error' | 'stream-error'>, 'extra-error' | 'stream-error'>
>
// @ts-expect-error Decoder controls remain separate from captured requests.
utils.views.plain.liveKey(captured)
// @ts-expect-error The adapter owns response mode.
utils.views.plain.liveOptions({ input: { ...input, responseMode: 'response-only' } })
// @ts-expect-error Live queries retain one value and expose no history bound.
utils.views.plain.liveOptions({ input, maxChunks: 2 })
// @ts-expect-error Live queries expose no accumulated refetch mode.
utils.views.plain.liveKey(input, { refetchMode: 'append' })
// @ts-expect-error Caller hashes belong in QueryClient defaults.
utils.views.plain.liveOptions({ input, queryKeyHashFn: JSON.stringify })
// @ts-expect-error Inputless live endpoints reject skipToken.
utils.events.liveOptions({ input: skipToken })
custom.views.plain.liveKey(input)

const UndefinedValue = Schema.Null.pipe(
  Schema.decodeTo(
    Schema.Void,
    SchemaTransformation.transform({
      decode: (): void => undefined,
      encode: (_value: void) => null,
    }),
  ),
)
const normalizationApi = HttpApi.make('live-normalization').add(
  HttpApiGroup.make('values').add(
    HttpApiEndpoint.get('plain', '/plain', {
      success: HttpApiSchema.StreamSse({ data: UndefinedValue }),
    }),
    HttpApiEndpoint.get('wrapped', '/wrapped', {
      success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamSse({ data: UndefinedValue }), {
        etag: Schema.String,
      }),
    }),
    HttpApiEndpoint.get('union', '/union', {
      success: HttpApiSchema.StreamSse({ data: Schema.Union([Schema.Finite, UndefinedValue]) }),
    }),
  ),
)
declare const normalizationClient: HttpApiClient.ForApi<typeof normalizationApi>
const normalized = createHttpApiQueryUtils(normalizationApi, {
  client: normalizationClient,
  keyPrefix: ['normalized'],
})
const undefinedData = queryClient.getQueryData(normalized.values.plain.liveKey())
true satisfies Assert<Equal<typeof undefinedData, null | undefined>>
const unionData = queryClient.getQueryData(normalized.values.union.liveKey())
true satisfies Assert<Equal<typeof unionData, number | null | undefined>>
const wrappedUndefinedData = queryClient.getQueryData(normalized.values.wrapped.liveKey())
true satisfies Assert<
  Equal<
    typeof wrappedUndefinedData,
    HttpApiSchema.withHeaders<void, { readonly etag: string }> | undefined
  >
>
const undefinedLive = useQuery(
  normalized.values.plain.liveOptions({
    initialData: null,
    select: (value) => {
      value satisfies null
      return 'ready' as const
    },
  }),
)
true satisfies Assert<Equal<typeof undefinedLive.data, 'ready'>>
const emptyError: EffectHttpApiQueryEmptyStreamError = new EffectHttpApiQueryEmptyStreamError({
  apiId: 'api',
  groupId: 'group',
  endpoint: 'empty',
  method: 'GET',
})
emptyError.operation satisfies 'live'
