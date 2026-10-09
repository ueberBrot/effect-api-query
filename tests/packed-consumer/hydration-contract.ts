import type { QueryClient } from '@tanstack/query-core'
import { Effect, Schema } from 'effect'
import type { HttpApiClient } from 'effect/http-api'
import type { RpcClient, RpcGroup } from 'effect/rpc'

import {
  HydrationPreparation,
  prepareProfileHydration,
  prepareProfileSnapshot,
} from './docs-hydration-async.ts'
import {
  dtoApi,
  dtoGroup,
  dtoHttpOptions,
  dtoRpcOptions,
  ProfileDto,
} from './docs-hydration-dto.ts'
import {
  Profile,
  profileApi,
  profileGroup,
  profileHttpOptions,
  profileRpcOptions,
} from './docs-hydration-rich.ts'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
type Success<T> = T extends Promise<infer A> ? A : never
type Services<T> = T extends Effect.Effect<unknown, unknown, infer R> ? R : never

declare const queryClient: QueryClient
declare const rpcClient: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof profileGroup>>
declare const httpClient: HttpApiClient.ForApi<typeof profileApi>
declare const dtoRpcClient: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof dtoGroup>>
declare const dtoHttpClient: HttpApiClient.ForApi<typeof dtoApi>

const rpcData = queryClient.query(profileRpcOptions(rpcClient))
const httpData = queryClient.query(profileHttpOptions(httpClient))
const rpcDto = queryClient.query(dtoRpcOptions(dtoRpcClient))
const httpDto = queryClient.query(dtoHttpOptions(dtoHttpClient))

type Contract = [
  Assert<Equal<Success<typeof rpcData>, Profile>>,
  Assert<Equal<Success<typeof httpData>, Profile>>,
  Assert<Equal<Success<typeof rpcDto>, typeof ProfileDto.Type>>,
  Assert<Equal<Success<typeof httpDto>, typeof ProfileDto.Type>>,
  Assert<Equal<Services<ReturnType<typeof prepareProfileSnapshot>>, HydrationPreparation>>,
  Assert<Equal<Services<ReturnType<typeof prepareProfileHydration>>, HydrationPreparation>>,
]

prepareProfileSnapshot(queryClient) satisfies Effect.Effect<
  string,
  Schema.SchemaError,
  HydrationPreparation
>
prepareProfileHydration(queryClient, '{}') satisfies Effect.Effect<
  void,
  Schema.SchemaError,
  HydrationPreparation
>
// @ts-expect-error The caller must provide the hydration preparation service
Effect.runPromise(prepareProfileSnapshot(queryClient))
// @ts-expect-error The caller must provide the hydration preparation service
Effect.runPromise(prepareProfileHydration(queryClient, '{}'))

declare const contract: Contract
contract satisfies [true, true, true, true, true, true]
