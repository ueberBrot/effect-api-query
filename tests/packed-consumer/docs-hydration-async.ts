import { defaultShouldDehydrateQuery, dehydrate, hydrate } from '@tanstack/query-core'
import type { DehydratedState, QueryClient } from '@tanstack/query-core'
import { Context, Effect, Schema } from 'effect'

import { Profile } from './docs-hydration-rich.ts'

export class HydrationPreparation extends Context.Service<
  HydrationPreparation,
  {
    readonly beforeEncode: Effect.Effect<void>
    readonly beforeDecode: Effect.Effect<void>
  }
>()('HydrationPreparation') {}

const PreparedProfile = Profile.pipe(
  Schema.middlewareEncoding<typeof Profile, HydrationPreparation>((encoding) =>
    Effect.flatMap(HydrationPreparation, ({ beforeEncode }) =>
      Effect.andThen(beforeEncode, encoding),
    ),
  ),
  Schema.middlewareDecoding((decoding) =>
    Effect.flatMap(HydrationPreparation, ({ beforeDecode }) =>
      Effect.andThen(beforeDecode, decoding),
    ),
  ),
)

export const prepareProfileSnapshot = (queryClient: QueryClient) =>
  Effect.gen(function* () {
    const snapshot = dehydrate(queryClient, {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query) =>
        defaultShouldDehydrateQuery(query) && query.queryKey[0] === 'profile',
    })
    const queries = yield* Effect.forEach(snapshot.queries, (query) =>
      Schema.encodeUnknownEffect(PreparedProfile)(query.state.data).pipe(
        Effect.map((data) => ({ ...query, state: { ...query.state, data } })),
      ),
    )
    return JSON.stringify({ ...snapshot, queries })
  })

export const prepareProfileHydration = (queryClient: QueryClient, json: string) =>
  Effect.gen(function* () {
    const snapshot: DehydratedState = JSON.parse(json)
    const queries = yield* Effect.forEach(snapshot.queries, (query) =>
      Schema.decodeUnknownEffect(PreparedProfile)(query.state.data).pipe(
        Effect.map((data) => ({ ...query, state: { ...query.state, data } })),
      ),
    )
    yield* Effect.sync(() => hydrate(queryClient, { ...snapshot, queries }))
  })
