import type { Effect, Schema, Scope, Stream } from 'effect'

import type { attachUserEvents } from './docs-user-events.ts'
import type {
  UserEvent,
  UserEventConsumerUnavailable,
  makeUserEventConsumer,
} from './user-events.ts'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value

type Attachment = Effect.Success<ReturnType<typeof attachUserEvents>>
declare const attachment: Attachment
interface DeliveryFailure {
  readonly _tag: 'DeliveryFailure'
}
interface DeliveryService {
  readonly _tag: 'DeliveryService'
}
declare const delivered: Stream.Stream<unknown, DeliveryFailure, DeliveryService>
const consumption = attachment.consume(delivered)
const delivery = attachment.consumer.deliver({
  schema: 'users.v1',
  ownerKey: 'owner',
  cursor: 1,
  kind: 'users.changed',
})
true satisfies Assert<
  Equal<Effect.Error<ReturnType<typeof makeUserEventConsumer>>, UserEventConsumerUnavailable>
>
true satisfies Assert<Equal<Effect.Services<ReturnType<typeof makeUserEventConsumer>>, Scope.Scope>>
true satisfies Assert<Equal<Effect.Error<typeof consumption>, DeliveryFailure | Schema.SchemaError>>
true satisfies Assert<Equal<Effect.Services<typeof consumption>, DeliveryService>>
true satisfies Assert<Equal<Effect.Error<typeof delivery>, Schema.SchemaError>>
true satisfies Assert<Equal<Effect.Services<typeof delivery>, never>>
true satisfies Assert<Equal<Parameters<typeof attachment.consumer.deliver>[0], UserEvent>>
true satisfies Assert<Equal<ReturnType<typeof attachment.consumer.flush>, Promise<void>>>
true satisfies Assert<Equal<Effect.Success<ReturnType<typeof attachment.consumer.resume>>, number>>
