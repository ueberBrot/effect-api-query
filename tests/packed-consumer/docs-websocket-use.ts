import { Effect } from 'effect'
import { fetchStreamSnapshot } from 'effect-api-query'
import { Socket } from 'effect/socket'

import { acquireSocketQueries } from './socket-client.ts'

export const readSocketSnapshot = Effect.fn('readSocketSnapshot')(function* (url: string) {
  const application = yield* acquireSocketQueries(url, 'account-42').pipe(
    Effect.provide(Socket.layerWebSocketConstructorGlobal),
  )
  const { queryClient, rpc } = application
  try {
    const reads = yield* Effect.promise(() =>
      Promise.all([
        queryClient.query(rpc.values.read.queryOptions({ input: { id: 1 } })),
        queryClient.query(rpc.values.read.queryOptions({ input: { id: 2 } })),
      ]),
    )
    const input = { channel: 'clock' }
    const history = yield* Effect.promise(() =>
      fetchStreamSnapshot(queryClient, rpc.values.watch.streamedOptions({ input, maxChunks: 20 }), {
        timeoutMs: 5_000,
      }),
    )
    const latest = yield* Effect.promise(() =>
      fetchStreamSnapshot(queryClient, rpc.values.watch.liveOptions({ input }), {
        timeoutMs: 5_000,
      }),
    )
    return { reads, history, latest }
  } finally {
    yield* application.dispose
  }
})
