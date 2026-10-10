import type { QueryClient } from '@tanstack/query-core'
import { Effect, Schema } from 'effect'

import { Profile } from './docs-hydration-rich.ts'
import {
  Cursor,
  HistoryElement,
  prepareViewHydration,
  prepareViewSnapshot,
  ProfilePages,
  SnapshotDecoding,
  SnapshotEncoding,
} from './docs-hydration-views.ts'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
type Services<T> = T extends Effect.Effect<unknown, unknown, infer R> ? R : never
type Contract = [
  Assert<Equal<typeof HistoryElement.Type, Profile | null | undefined>>,
  Assert<Equal<typeof ProfilePages.Type.pageParams, readonly Cursor[]>>,
  Assert<Equal<Services<ReturnType<typeof prepareViewSnapshot>>, SnapshotEncoding>>,
  Assert<Equal<Services<ReturnType<typeof prepareViewHydration>>, SnapshotDecoding>>,
]

declare const queryClient: QueryClient
prepareViewSnapshot(queryClient) satisfies Effect.Effect<
  string,
  Schema.SchemaError,
  SnapshotEncoding
>
prepareViewHydration(queryClient, '{}') satisfies Effect.Effect<
  void,
  Schema.SchemaError,
  SnapshotDecoding
>
// @ts-expect-error Snapshot encoding requires its own caller-provided service.
Effect.runPromise(prepareViewSnapshot(queryClient))
const decodingDoesNotEncode = prepareViewSnapshot(queryClient).pipe(
  Effect.provideService(SnapshotDecoding, { beforeDecode: Effect.void }),
)
// @ts-expect-error A decoding service cannot satisfy encoding.
Effect.runPromise(decodingDoesNotEncode)
// @ts-expect-error Snapshot decoding requires its own caller-provided service.
Effect.runPromise(prepareViewHydration(queryClient, '{}'))
const encodingDoesNotDecode = prepareViewHydration(queryClient, '{}').pipe(
  Effect.provideService(SnapshotEncoding, { beforeEncode: Effect.void }),
)
// @ts-expect-error An encoding service cannot satisfy decoding.
Effect.runPromise(encodingDoesNotDecode)

declare const contract: Contract
contract satisfies [true, true, true, true]
