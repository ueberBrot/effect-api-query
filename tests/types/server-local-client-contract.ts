// This upstream design proof adds no library export or published adapter contract.
import { Context, Effect, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { makeServerLocalRpcClient } from '../fixtures/server-local-rpc.ts'

class CodecService extends Context.Service<CodecService, { readonly suffix: string }>()(
  'effect-api-query/tests/ServerLocalCodecService',
) {}

const Payload = Schema.Struct({ name: Schema.String }).pipe(
  Schema.middlewareEncoding((encoding) => Effect.flatMap(CodecService, () => encoding)),
)
const Read = Rpc.make('profiles.read', {
  payload: Payload,
  success: Schema.String,
  error: Schema.Literal('not-found'),
})
const group = RpcGroup.make(Read)
const construction = makeServerLocalRpcClient(group)
declare const client: Effect.Success<typeof construction>
const call = client('profiles.read', {
  name: 'Ada',
})
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Condition extends true> = Condition
true satisfies Assert<Equal<Effect.Success<typeof call>, string>>
true satisfies Assert<Equal<Effect.Error<typeof call>, 'not-found'>>
true satisfies Assert<Equal<Effect.Services<typeof call>, CodecService>>
// @ts-expect-error The declaration-derived client does not accept a numeric profile name.
const invalidCall = client('profiles.read', { name: 1 })
void [call, invalidCall]
