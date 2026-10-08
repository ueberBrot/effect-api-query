import { Effect, Schema, Stream } from 'effect'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'

const GetUser = Rpc.make('users.get', {
  payload: {
    id: Schema.Finite,
    locale: Schema.String.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed('en')),
    ),
  },
  success: Schema.Struct({
    id: Schema.Finite,
    locale: Schema.String,
    name: Schema.String,
  }),
  error: Schema.Literal('not-found'),
})

const Ping = Rpc.make('health.ping', { success: Schema.Void })
const Fail = Rpc.make('diagnostics.fail', {
  success: Schema.String,
  error: Schema.Literal('declared-failure'),
})
const Watch = Rpc.make('events.watch', {
  success: Schema.String,
  stream: true,
})
const ObjectNamed = Rpc.make('toString.child', { success: Schema.Void })

export const group = RpcGroup.make(GetUser, Ping, Fail, Watch, ObjectNamed)

// The stateless handlers and their layer are shared; each test gets a fresh scoped
// transport.
const handlers = group.of({
  'diagnostics.fail': () => Effect.fail('declared-failure' as const),
  'events.watch': () => Stream.empty,
  'health.ping': () => Effect.void,
  'toString.child': () => Effect.void,
  'users.get': (payload) =>
    Effect.succeed({ id: payload.id, locale: payload.locale ?? 'en', name: 'Ada' }),
})
const handlersLayer = group.toLayer(handlers)

/** Acquires an official in-memory flat client for an RPC group and its handlers. */
export const makeRpcTestClient = Effect.fn('TestRpc.makeRpcTestClient')(function* <
  Rpcs extends Rpc.Any,
  const Handlers extends RpcGroup.HandlersFrom<Rpcs>,
>(rpcGroup: RpcGroup.RpcGroup<Rpcs>, rpcHandlers: Handlers) {
  return yield* RpcTest.makeClient(rpcGroup, { flatten: true }).pipe(
    Effect.provide(rpcGroup.toLayer(rpcHandlers)),
  )
})

/** Acquires a fresh scoped client backed by the shared test handlers. */
export const makeClient = Effect.fn('TestRpc.makeClient')(function* () {
  return yield* RpcTest.makeClient(group, { flatten: true }).pipe(Effect.provide(handlersLayer))
})
