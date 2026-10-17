import { QueryClient } from '@tanstack/query-core'
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  viewPrefix,
  withMutationPolicy,
  withQueryPolicy,
} from '@ueberbrot/effect-api-query'
import type {
  InferInput,
  InferMutationData,
  InferMutationError,
  InferQueryData,
  InferQueryError,
  QueryPolicy,
} from '@ueberbrot/effect-api-query'
import type { HttpApiClient } from 'effect/http-api'
import type { RpcClient, RpcGroup } from 'effect/rpc'

import { exampleRpcGroup } from '../../examples/contracts/src/contracts'
import { exampleHttpApi } from '../../examples/contracts/src/http-api'

declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof exampleRpcGroup>>
declare const httpClient: HttpApiClient.ForApi<typeof exampleHttpApi>
const rpc = createRpcQueryUtils(exampleRpcGroup, { client, keyPrefix: ['policy-app'] })
const http = createHttpApiQueryUtils(exampleHttpApi, {
  client: httpClient,
  keyPrefix: ['policy-app'],
})
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 600_000, retry: false, retryDelay: 250 },
    mutations: { retry: false },
  },
})

const registerDefaults = () => {
  queryClient.setQueryDefaults(rpc.key(), { staleTime: 60_000 })
  queryClient.setQueryDefaults(rpc.users.key(), { retry: 2 })
  queryClient.setQueryDefaults(viewPrefix(rpc.users.get, 'query'), { staleTime: 120_000 })

  const user = rpc.users.get.queryOptions({
    input: { id: 1 },
    select: (value) => value.name,
  })
  const refreshUser = rpc.users.get.queryOptions({
    input: { id: 1 },
    staleTime: 0,
    retry: false,
  })

  queryClient.setQueryDefaults(http.key(), {
    queryKeyHashFn: (key) => `users:${JSON.stringify(key)}`,
  })
  queryClient.setQueryDefaults(http.users.key(), { retry: 1 })
  queryClient.setQueryDefaults(viewPrefix(http.users.get, 'metadata'), { staleTime: 5_000 })

  const input = { params: { id: 1 }, query: {} }
  const httpUser = http.users.get.queryOptions({ input })
  const metadata = http.users.get.metadataOptions({ input })
}

const policy = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: false,
} satisfies QueryPolicy<typeof rpc.users.get>
const userOptions = withQueryPolicy(rpc.users.get, 'query', policy)
const user = userOptions({ input: { id: 1 }, select: (value) => value.name })
const refreshUser = userOptions({ input: { id: 1 }, staleTime: 0, retry: false })

const createUserOptions = withMutationPolicy(rpc.users.create, {
  onSuccess: async (created) => {
    queryClient.setQueryData(rpc.users.get.queryKey({ id: created.id }), created)
    await queryClient.invalidateQueries({ queryKey: rpc.users.key() })
  },
})
declare const reportCreationFailure: (name: string | undefined, error: unknown) => void
const createUser = createUserOptions({
  onMutate: (variables) => ({ submittedName: variables.name }),
  onError: (error, _variables, context) => {
    reportCreationFailure(context?.submittedName, error)
  },
})

queryClient.setQueryDefaults(viewPrefix(rpc.users.get, 'query'), { staleTime: 120_000 })
queryClient.setQueryDefaults(viewPrefix(http.users.get, 'metadata'), { staleTime: 5_000 })
const queryPrefix = viewPrefix(rpc.users.get, 'query')
await queryClient.invalidateQueries({ queryKey: queryPrefix, type: 'inactive' })
const historyPrefix = viewPrefix(rpc.diagnostics.stream, 'streamed')
await queryClient.invalidateQueries({ queryKey: historyPrefix })

const input: InferInput<typeof rpc.users.get> = { id: 1 }
type UserData = InferQueryData<typeof rpc.users.get>
type HistoryData = InferQueryData<typeof rpc.diagnostics.stream, 'streamed'>
type UserError = InferQueryError<typeof rpc.users.get>
type CreateUserInput = InferInput<typeof rpc.users.create>
type CreatedUser = InferMutationData<typeof rpc.users.create>
type CreateUserError = InferMutationError<typeof rpc.users.create>

const selectedOptions = rpc.users.get.queryOptions({
  input: { id: 1 },
  select: (value) => value.name,
})
const selectedName = await queryClient.query(selectedOptions)
const cachedUser = queryClient.getQueryData(selectedOptions.queryKey)
