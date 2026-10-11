import { Effect, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

const User = Schema.Struct({ id: Schema.Int, name: Schema.String })
export const usersRpc = RpcGroup.make(
  Rpc.make('users.get', {
    payload: {
      id: Schema.Int,
      locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))),
    },
    success: User,
  }),
  Rpc.make('users.create', {
    payload: { name: Schema.String },
    success: User,
  }),
)
