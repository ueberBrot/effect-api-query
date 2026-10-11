import { Effect, Stream } from 'effect'
import type { Reactivity } from 'effect/reactivity'

import { decodeUserEvent, makeUserEventConsumer } from '../fixtures/user-events.ts'
import type { UserEventOwner } from '../fixtures/user-events.ts'

const attachUserEvents = Effect.fnUntraced(function* (
  owner: UserEventOwner,
  reactivity: Reactivity.Reactivity,
) {
  const consumer = yield* makeUserEventConsumer(owner, reactivity, {
    observedUsers: [{ id: 1, locale: 'en' }],
  })
  const consume = <E, R>(events: Stream.Stream<unknown, E, R>) =>
    events.pipe(
      Stream.mapEffect((event) => decodeUserEvent(event)),
      Stream.runForEach(consumer.deliver),
      Effect.ensuring(Effect.promise(consumer.flush)),
    )
  return {
    consumer,
    consume,
    latestDiagnostic: owner.rpcQuery.diagnostics.stream.liveOptions(),
    diagnosticHistory: owner.rpcQuery.diagnostics.stream.streamedOptions({
      maxChunks: 64,
      refetchMode: 'reset',
    }),
  }
})
