import { QueryClient } from '@tanstack/query-core'
import { Effect, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient, RpcClientError } from 'effect/rpc'

import { createRpcQueryUtils } from '../../src/index.ts'

export const transportGroup = RpcGroup.make(
  Rpc.make('values.read', { payload: { id: Schema.Int }, success: Schema.Int }),
)

export const queryTransportCalls = Effect.fnUntraced(function* (
  client: RpcClient.RpcClient.Flat<
    RpcGroup.Rpcs<typeof transportGroup>,
    RpcClientError.RpcClientError
  >,
  count: number,
) {
  const queryClient = new QueryClient()
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      queryClient.clear()
    }),
  )
  const utils = createRpcQueryUtils(transportGroup, { client, keyPrefix: ['overhead'] })
  const values = yield* Effect.promise(async () =>
    Promise.all(
      Array.from({ length: count }, async (_unused, id) =>
        queryClient.query(utils.values.read.queryOptions({ input: { id }, retry: false })),
      ),
    ),
  )
  return { values, cacheEntries: queryClient.getQueryCache().getAll().length }
})
