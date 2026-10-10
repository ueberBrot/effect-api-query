import { expect, it } from '@effect/vitest'
import { QueryClient } from '@tanstack/query-core'
import { Effect, Schema, Stream } from 'effect'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'

import { createRpcQueryUtils } from '#effect-api-query'

it.live('appends decoded values without mutating seeded sparse history', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const Watch = Rpc.make('samples.watch', { success: Schema.Finite, stream: true })
      const group = RpcGroup.make(Watch)
      const client = yield* RpcTest.makeClient(group, { flatten: true }).pipe(
        Effect.provide(group.toLayer({ 'samples.watch': () => Stream.make(8) })),
      )
      const queryClient = new QueryClient()
      const initialData: number[] = []
      initialData.length = 3
      initialData[0] = 1
      initialData[2] = 7
      const options = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['stream-publication'],
      }).samples.watch.streamedOptions({ initialData, maxChunks: 4, refetchMode: 'append' })
      try {
        const data = yield* Effect.promise(async () => await queryClient.query(options))
        expect(data).toStrictEqual([1, undefined, 7, 8])
        expect(initialData).toHaveLength(3)
        expect(1 in initialData).toBe(false)
      } finally {
        queryClient.clear()
      }
    }),
  ),
)
