import { defaultShouldDehydrateQuery, dehydrate, hydrate } from '@tanstack/query-core'
import type { DehydratedState, QueryClient, QueryKey } from '@tanstack/query-core'
import { Context, Effect, Schema, SchemaTransformation } from 'effect'
import { HttpApiSchema } from 'effect/http-api'

import { Profile } from './docs-hydration-rich.ts'

const UndefinedElement = Schema.Struct({ _tag: Schema.Literal('Undefined') }).pipe(
  Schema.decodeTo(
    Schema.Undefined,
    SchemaTransformation.transform({
      decode: () => undefined,
      encode: () => ({ _tag: 'Undefined' as const }),
    }),
  ),
)

export const HistoryElement = Schema.Union([Profile, Schema.Null, UndefinedElement])
const ProfileHistory = Schema.Array(HistoryElement)

export class Cursor extends Schema.Class<Cursor>('Cursor')({ offset: Schema.BigIntFromString }) {
  isStart(): boolean {
    return this.offset === 0n
  }
}

export const ProfilePage = Schema.Struct({
  rows: Schema.Array(Profile),
  next: Schema.NullOr(Schema.Finite),
})
export const ProfilePages = Schema.Struct({
  pages: Schema.Array(ProfilePage),
  pageParams: Schema.Array(Cursor),
})

export class ArchivedProfile extends Schema.Class<ArchivedProfile>('ArchivedProfile')({
  archived: Schema.Literal(true),
  name: Schema.String,
  credits: Schema.BigIntFromString,
}) {
  summary(): string {
    return `${this.name}: ${this.credits} archived credits`
  }
}

const DecodedHeaders = Schema.Struct({ 'x-version': Schema.FiniteFromString })
export const WrappedElement = Schema.Struct({ body: HistoryElement, headers: DecodedHeaders }).pipe(
  Schema.decodeTo(
    Schema.toType(HttpApiSchema.WithHeaders(HistoryElement, DecodedHeaders)),
    SchemaTransformation.transform({
      decode: HttpApiSchema.withHeaders,
      encode: ({ body, headers }) => ({ body, headers }),
    }),
  ),
)
const BufferedBody = Schema.Union([Profile, ArchivedProfile])
export const BufferedProfile = Schema.Struct({
  body: BufferedBody,
  headers: DecodedHeaders,
}).pipe(
  Schema.decodeTo(
    Schema.toType(HttpApiSchema.WithHeaders(BufferedBody, DecodedHeaders)),
    SchemaTransformation.transform({
      decode: HttpApiSchema.withHeaders,
      encode: ({ body, headers }) => ({ body, headers }),
    }),
  ),
)
export const ProfileMetadata = Schema.Struct({
  data: BufferedProfile,
  status: Schema.Finite,
  headers: Schema.Record(Schema.String, Schema.String),
})

export class SnapshotEncoding extends Context.Service<
  SnapshotEncoding,
  {
    readonly beforeEncode: Effect.Effect<void>
  }
>()('SnapshotEncoding') {}

export class SnapshotDecoding extends Context.Service<
  SnapshotDecoding,
  {
    readonly beforeDecode: Effect.Effect<void>
  }
>()('SnapshotDecoding') {}

const prepared = <S extends Schema.Codec<unknown, unknown, never, never>>(schema: S) =>
  schema.pipe(
    Schema.middlewareEncoding<S, SnapshotEncoding | S['EncodingServices']>((encoding) =>
      Effect.flatMap(SnapshotEncoding, ({ beforeEncode }) =>
        Effect.andThen(beforeEncode, encoding),
      ),
    ),
    Schema.middlewareDecoding((decoding) =>
      Effect.flatMap(SnapshotDecoding, ({ beforeDecode }) =>
        Effect.andThen(beforeDecode, decoding),
      ),
    ),
  )

const codecs = {
  history: prepared(ProfileHistory),
  infinite: prepared(ProfilePages),
  live: prepared(Schema.NullOr(Profile)),
  buffered: prepared(BufferedProfile),
  metadata: prepared(ProfileMetadata),
  'wrapped-history': prepared(Schema.Array(WrappedElement)),
  'wrapped-live': prepared(WrappedElement),
}
const ViewId = Schema.Literals([
  'history',
  'infinite',
  'live',
  'buffered',
  'metadata',
  'wrapped-history',
  'wrapped-live',
])

const codecFor = Effect.fnUntraced(function* (key: QueryKey) {
  yield* Schema.decodeUnknownEffect(Schema.Literal('hydration-views'))(key[0])
  const id = yield* Schema.decodeUnknownEffect(ViewId)(key[1])
  return codecs[id]
})

export const prepareViewSnapshot = Effect.fnUntraced(function* (queryClient: QueryClient) {
  const snapshot = dehydrate(queryClient, {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) && query.queryKey[0] === 'hydration-views',
  })
  const queries = yield* Effect.forEach(
    snapshot.queries,
    Effect.fnUntraced(function* (query) {
      const codec = yield* codecFor(query.queryKey)
      const data = yield* Schema.encodeUnknownEffect(codec)(query.state.data)
      return { ...query, state: { ...query.state, data } }
    }),
  )
  return JSON.stringify({ ...snapshot, queries })
})

export const prepareViewHydration = Effect.fnUntraced(function* (
  queryClient: QueryClient,
  json: string,
) {
  const snapshot: DehydratedState = JSON.parse(json)
  const queries = yield* Effect.forEach(
    snapshot.queries,
    Effect.fnUntraced(function* (query) {
      const codec = yield* codecFor(query.queryKey)
      const data = yield* Schema.decodeUnknownEffect(codec)(query.state.data)
      return { ...query, state: { ...query.state, data } }
    }),
  )
  yield* Effect.sync(() => hydrate(queryClient, { ...snapshot, queries }))
})
