import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import {
  exerciseSocketConcurrency,
  exerciseSocketInterruption,
  exerciseSocketReplacement,
} from '../../../tests/packed-consumer/websocket-checks.ts'

it.live(
  'runs concurrent reads and both open stream views through a ready WebSocket client',
  () =>
    Effect.gen(function* () {
      expect(yield* Effect.promise(exerciseSocketConcurrency)).toStrictEqual({
        reads: [10, 20],
        history: [1],
        latest: 1,
        historyCancelled: true,
        liveContinued: 2,
        liveCancelled: true,
      })
    }),
  20_000,
)

it.live('retires one socket owner before disposal and acquires an independent replacement', () =>
  Effect.gen(function* () {
    expect(yield* Effect.promise(exerciseSocketReplacement)).toStrictEqual({
      oldOwnerCancelled: true,
      unrelatedOwnerContinued: 2,
      replacementValue: 1,
      disconnectsAfterQueryCancellation: true,
    })
  }),
)

it.live('preserves independently interrupted wire Causes while other socket calls continue', () =>
  Effect.gen(function* () {
    expect(yield* Effect.promise(exerciseSocketInterruption)).toStrictEqual({
      comparedWireCauses: 5,
      unaffectedRead: 30,
    })
  }),
)
