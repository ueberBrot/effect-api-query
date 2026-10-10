import { CommandStatus, DiagnosticStatus, User, UserPage } from '@effect-api-query/contracts'
import { hashKey } from '@tanstack/react-query'
import type { DehydratedState, QueryKey } from '@tanstack/react-query'
import { Context, Effect, Schema } from 'effect'

import type { TanStackStartApplication } from './application.ts'

export interface SnapshotPreparation {
  readonly beforeEncode: Effect.Effect<void>
  readonly beforeDecode: Effect.Effect<void>
}

type SnapshotEncodingService = Pick<SnapshotPreparation, 'beforeEncode'>
const SnapshotEncoding = Context.Service<SnapshotEncodingService>('Start/SnapshotEncoding')
type SnapshotDecodingService = Pick<SnapshotPreparation, 'beforeDecode'>
const SnapshotDecoding = Context.Service<SnapshotDecodingService>('Start/SnapshotDecoding')

const prepared = <S extends Schema.Codec<unknown, unknown>>(schema: S) =>
  schema.pipe(
    Schema.middlewareEncoding<S, SnapshotEncodingService>((encoding) =>
      SnapshotEncoding.pipe(
        Effect.flatMap(({ beforeEncode }) => beforeEncode.pipe(Effect.andThen(encoding))),
      ),
    ),
    Schema.middlewareDecoding((decoding) =>
      SnapshotDecoding.pipe(
        Effect.flatMap(({ beforeDecode }) => beforeDecode.pipe(Effect.andThen(decoding))),
      ),
    ),
  )

const Users = prepared(Schema.Array(User))
const SingleUser = prepared(User)
const Pages = prepared(
  Schema.Struct({ pages: Schema.Array(UserPage), pageParams: Schema.Array(Schema.Int) }),
)
const Status = prepared(DiagnosticStatus)
const Command = prepared(Schema.NullOr(CommandStatus))
const Text = prepared(Schema.String)
const History = prepared(Schema.Array(Schema.String))

export interface SnapshotCodecs {
  readonly encode: (queries: DehydratedState['queries']) => Promise<DehydratedState['queries']>
  readonly decode: (queries: DehydratedState['queries']) => Promise<DehydratedState['queries']>
}

export const makeSnapshotPreparation = (
  { rpcQuery, httpQuery, runPreparation }: TanStackStartApplication,
  services: SnapshotPreparation,
): SnapshotCodecs => {
  const codecs = [
    { prefix: rpcQuery.users.list.queryKey(), codec: Users },
    { prefix: httpQuery.users.list.queryKey(), codec: Users },
    { prefix: [...rpcQuery.users.get.key(), 'query'], codec: SingleUser },
    { prefix: [...httpQuery.users.get.key(), 'query'], codec: SingleUser },
    { prefix: [...rpcQuery.users.page.key(), 'infinite'], codec: Pages },
    { prefix: [...httpQuery.users.page.key(), 'infinite'], codec: Pages },
    { prefix: rpcQuery.diagnostics.status.queryKey(), codec: Status },
    { prefix: httpQuery.diagnostics.status.queryKey(), codec: Status },
    { prefix: [...rpcQuery.diagnostics.operationStatus.key(), 'query'], codec: Status },
    { prefix: [...httpQuery.diagnostics.operationStatus.key(), 'query'], codec: Status },
    { prefix: [...rpcQuery.commands.status.key(), 'query'], codec: Command },
    { prefix: [...rpcQuery.diagnostics.slow.key(), 'query'], codec: Text },
    { prefix: [...httpQuery.diagnostics.slow.key(), 'query'], codec: Text },
    { prefix: [...rpcQuery.diagnostics.stream.key(), 'live'], codec: Text },
    { prefix: [...rpcQuery.diagnostics.stream.key(), 'streamed'], codec: History },
  ]
  const codecFor = (key: QueryKey) =>
    codecs.find(({ prefix }) => hashKey(key.slice(0, prefix.length)) === hashKey(prefix))?.codec
  const encode = Effect.fnUntraced(function* (queries: DehydratedState['queries']) {
    return yield* Effect.forEach(
      Effect.fnUntraced(function* (query: DehydratedState['queries'][number]) {
        const codec = codecFor(query.queryKey)
        if (codec === undefined) {
          return yield* Effect.die(new TypeError('No Start snapshot codec for query'))
        }
        const data = yield* Schema.encodeUnknownEffect(codec)(query.state.data)
        return { ...query, state: { ...query.state, data } }
      }),
    )(queries)
  })
  const decode = Effect.fnUntraced(function* (queries: DehydratedState['queries']) {
    return yield* Effect.forEach(
      Effect.fnUntraced(function* (query: DehydratedState['queries'][number]) {
        const codec = codecFor(query.queryKey)
        if (codec === undefined) {
          return yield* Effect.die(new TypeError('No Start snapshot codec for query'))
        }
        const data = yield* Schema.decodeUnknownEffect(codec)(query.state.data)
        return { ...query, state: { ...query.state, data } }
      }),
    )(queries)
  })
  return {
    encode: async (queries: DehydratedState['queries']) =>
      runPreparation(encode(queries).pipe(Effect.provideService(SnapshotEncoding, services))),
    decode: async (queries: DehydratedState['queries']) =>
      runPreparation(decode(queries).pipe(Effect.provideService(SnapshotDecoding, services))),
  }
}
