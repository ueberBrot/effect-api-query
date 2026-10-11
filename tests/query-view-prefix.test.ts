import { expect, it } from '@effect/vitest'
import { QueryClient } from '@tanstack/query-core'
import { Effect, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { createRpcQueryUtils, viewPrefix } from '#effect-api-query'

import { makeRpcTestClient } from './fixtures/effect-rpc'

it.effect('invalidates every ordinary input while keeping infinite data fresh', () =>
  Effect.gen(function* () {
    const group = RpcGroup.make(
      Rpc.make('users.read', { payload: { id: Schema.Int }, success: Schema.String }),
    )
    const client = yield* makeRpcTestClient(group, { 'users.read': () => Effect.succeed('Ada') })
    const utils = createRpcQueryUtils(group, { client, keyPrefix: ['view-prefix'] })
    const queryClient = new QueryClient()
    const first = utils.users.read.queryKey({ id: 1 })
    const second = utils.users.read.queryKey({ id: 2 })
    const paged = utils.users.read.infiniteKey({ id: 1 })
    try {
      queryClient.setQueryData(first, 'Ada')
      queryClient.setQueryData(second, 'Grace')
      queryClient.setQueryData(paged, { pages: ['Ada'], pageParams: [1] })
      const prefix = viewPrefix(utils.users.read, 'query')
      yield* Effect.promise(async () => {
        await queryClient.invalidateQueries({ queryKey: prefix })
      })
      expect(queryClient.getQueryState(first)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(second)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(paged)?.isInvalidated).toBe(false)
      queryClient.setQueryDefaults(prefix, { staleTime: 60_000 })
      expect(queryClient.getQueryDefaults(first).staleTime).toBe(60_000)
      expect(queryClient.getQueryDefaults(paged).staleTime).toBeUndefined()
    } finally {
      queryClient.clear()
    }
  }),
)
