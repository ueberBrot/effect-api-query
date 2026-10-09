import type { QueryClient, QueryExecuteOptions } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils, fetchStreamSnapshot, skipToken } from 'effect-api-query'
import type { StreamSnapshotOptions } from 'effect-api-query'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import type { HttpApiClient } from 'effect/http-api'

const group = RpcGroup.make(
  Rpc.make('watch', { payload: { channel: Schema.String }, success: Schema.UndefinedOr(Schema.Int), stream: true }),
)
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>
declare const queryClient: QueryClient
const utils = createRpcQueryUtils(group, { client, keyPrefix: ['snapshot-types'] })
const streamed = utils.watch.streamedOptions({ input: { channel: 'owned' } })
const live = utils.watch.liveOptions({ input: { channel: 'owned' } })

fetchStreamSnapshot(queryClient, streamed) satisfies Promise<readonly (number | undefined)[]>
fetchStreamSnapshot(queryClient, live) satisfies Promise<number | null>
fetchStreamSnapshot(queryClient, { ...streamed, select: (values) => values.length }) satisfies Promise<number>
fetchStreamSnapshot(queryClient, { ...live, select: (value) => value === null ? 'empty' : `${value}` }) satisfies Promise<string>
fetchStreamSnapshot(queryClient, streamed, { mode: 'cached', signal: new AbortController().signal, timeoutMs: 500 }) satisfies Promise<readonly (number | undefined)[]>
const controls = { mode: 'fresh', timeoutMs: 1_000 } as const satisfies StreamSnapshotOptions
fetchStreamSnapshot(queryClient, live, controls)

declare const native: QueryExecuteOptions<string, Error, number> & { queryFn: () => Promise<string> }
fetchStreamSnapshot(queryClient, native) satisfies Promise<number>
const api = HttpApi.make('snapshot-types').add(HttpApiGroup.make('events').add(
  HttpApiEndpoint.get('watch', '/watch', { success: HttpApiSchema.StreamSse({ data: Schema.Int }) }),
))
declare const httpClient: HttpApiClient.ForApi<typeof api>
const http = createHttpApiQueryUtils(api, { client: httpClient, keyPrefix: ['snapshot-types'] })
fetchStreamSnapshot(queryClient, http.events.watch.streamedOptions()) satisfies Promise<readonly number[]>
// @ts-expect-error Skipped options cannot own a callable query function
fetchStreamSnapshot(queryClient, utils.watch.liveOptions({ input: skipToken }))
// @ts-expect-error A snapshot requires a supplied callable query function
fetchStreamSnapshot(queryClient, { queryKey: ['missing'] })
// @ts-expect-error Infinite page execution uses a different cache shape and lifecycle
fetchStreamSnapshot(queryClient, { ...streamed, initialPageParam: 0 })
// @ts-expect-error Snapshot mode is explicit
fetchStreamSnapshot(queryClient, live, { mode: 'join' })
