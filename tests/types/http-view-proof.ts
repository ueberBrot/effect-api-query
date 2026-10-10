import { Context, Effect, Schema, SchemaTransformation } from 'effect'
import type { Stream } from 'effect'
import type { Sse } from 'effect/encoding'
import type { HttpClientError } from 'effect/http'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import type { HttpApiClient } from 'effect/http-api'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value

class Scale extends Context.Service<Scale, { readonly factor: number }>()('HttpViewProof/Scale') {}
const Value = Schema.Finite.pipe(
  Schema.decodeTo(
    Schema.Finite,
    SchemaTransformation.transformEffect({
      decode: (value) => Scale.pipe(Effect.map(({ factor }) => value * factor)),
      encode: Effect.succeed,
    }),
  ),
)
const Expired = Schema.TaggedStruct('Expired', { reason: Schema.String })
const Plain = HttpApiEndpoint.get('plain', '/plain', {
  params: { id: Schema.FiniteFromString },
  success: HttpApiSchema.StreamSse({ data: Value, error: Expired }),
})
const Wrapped = HttpApiEndpoint.get('wrapped', '/wrapped', {
  success: HttpApiSchema.WithHeaders(HttpApiSchema.StreamSse({ data: Value }), {
    'x-version': Schema.FiniteFromString,
  }),
})
const Buffered = HttpApiEndpoint.get('buffered', '/buffered', {
  success: HttpApiSchema.WithHeaders(Schema.FiniteFromString, {
    'x-version': Schema.FiniteFromString,
  }),
})
const Api = HttpApi.make('proof').add(HttpApiGroup.make('views').add(Plain, Wrapped, Buffered))
declare const client: HttpApiClient.ForApi<typeof Api, 'client-error', 'client-service'>

const plain = client.views.plain({ params: { id: 1 }, responseMode: 'decoded-only' })
type PlainStream = Effect.Success<typeof plain>
true satisfies Assert<Equal<Stream.Success<PlainStream>, number>>
true satisfies Assert<Equal<Stream.Services<PlainStream>, never>>
true satisfies Assert<
  Equal<
    Stream.Error<PlainStream>,
    | typeof Expired.Type
    | HttpClientError.HttpClientError
    | Schema.SchemaError
    | Sse.Retry
    | Sse.SseError
  >
>
true satisfies Assert<Equal<Effect.Services<typeof plain>, Scale | 'client-service'>>
true satisfies Assert<
  Equal<
    Effect.Error<typeof plain>,
    'client-error' | HttpClientError.HttpClientError | Schema.SchemaError
  >
>

const wrapped = client.views.wrapped({ responseMode: 'decoded-only' })
type WrappedSuccess = Effect.Success<typeof wrapped>
true satisfies Assert<Equal<Stream.Success<WrappedSuccess['body']>, number>>
true satisfies Assert<Equal<WrappedSuccess['headers'], { readonly 'x-version': number }>>
true satisfies Assert<Equal<Effect.Services<typeof wrapped>, Scale | 'client-service'>>

type Chunk<Value> =
  Value extends HttpApiSchema.withHeaders<infer Body, infer Headers>
    ? HttpApiSchema.withHeaders<Chunk<Body>, Headers>
    : Value extends Stream.Stream<infer Data, infer _Error, infer _Services>
      ? Data
      : never
true satisfies Assert<
  Equal<Chunk<WrappedSuccess>, HttpApiSchema.withHeaders<number, { readonly 'x-version': number }>>
>

type Request<Endpoint extends HttpApiEndpoint.ConstraintRequest> = Omit<
  Exclude<
    HttpApiEndpoint.ClientRequest<
      Endpoint['~Params'],
      Endpoint['~Query'],
      Endpoint['~Payload'],
      Endpoint['~Headers'],
      'decoded-only'
    >,
    void
  >,
  'responseMode' | 'sseOptions'
> & { readonly responseMode?: never; readonly sseOptions?: never }
declare const encodeKey: (request: Request<typeof Plain>) => string
encodeKey({ params: { id: 1 } })
// @ts-expect-error SSE controls are separate from decoded request identity input.
encodeKey({ params: { id: 1 }, sseOptions: { maxEventSize: 1024 } })
// @ts-expect-error An adapter owns the response mode for each concrete view.
encodeKey({ params: { id: 1 }, responseMode: 'response-only' })
const requestWithControls = { params: { id: 1 }, sseOptions: { maxEventSize: 1024 } }
// @ts-expect-error Captured request values cannot carry decoder controls either.
encodeKey(requestWithControls)

const buffered = client.views.buffered({ responseMode: 'decoded-and-response' })
true satisfies Assert<
  Equal<
    Effect.Success<typeof buffered>[0],
    HttpApiSchema.withHeaders<number, { readonly 'x-version': number }>
  >
>
true satisfies Assert<Equal<Effect.Services<typeof buffered>, 'client-service'>>
