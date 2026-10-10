import type { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createRpcQueryUtils, fetchStreamSnapshot } from 'effect-api-query'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'

export const updates = RpcGroup.make(
  Rpc.make('updates.watch', {
    payload: { channel: Schema.String },
    success: Schema.String,
    stream: true,
  }),
)

export async function captureUpdates<E>(
  queryClient: QueryClient,
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof updates>, E>,
  signal: AbortSignal,
) {
  const rpc = createRpcQueryUtils<typeof updates, readonly ['updates'], E>(updates, {
    client,
    keyPrefix: ['updates'],
  })
  const input = { channel: 'announcements' }
  const history = await fetchStreamSnapshot(
    queryClient,
    rpc.updates.watch.streamedOptions({
      input,
      retry: false,
      maxChunks: 20,
    }),
    { signal, timeoutMs: 5_000 },
  )
  const latest = await fetchStreamSnapshot(
    queryClient,
    rpc.updates.watch.liveOptions({
      input,
      retry: false,
    }),
    { signal, timeoutMs: 5_000 },
  )
  return { history, latest }
}
