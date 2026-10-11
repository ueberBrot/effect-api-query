import type { dataTagSymbol, InfiniteData, QueryClient, SkipToken } from '@tanstack/query-core'
import { useInfiniteQuery, useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Effect, Schema } from 'effect'
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  skipToken,
  viewPrefix,
  withMutationPolicy,
  withQueryPolicy,
} from 'effect-api-query'
import type {
  EffectHttpApiQueryError,
  EffectRpcQueryError,
  InferInput,
  InferMutationData,
  InferMutationError,
  InferQueryData,
  InferQueryError,
  MutationPolicy,
  QueryPolicy,
  RpcQueryUtils,
} from 'effect-api-query'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import type { HttpApiClient } from 'effect/http-api'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value

const group = RpcGroup.make(
  Rpc.make('read', {
    payload: {
      id: Schema.Int,
      locale: Schema.String.pipe(
        Schema.optionalKey,
        Schema.withConstructorDefault(Effect.succeed('en')),
      ),
    },
    success: Schema.UndefinedOr(Schema.Int),
    error: Schema.Literal('missing'),
  }),
  Rpc.make('ping'),
  Rpc.make('watch', {
    payload: { channel: Schema.String },
    success: Schema.UndefinedOr(Schema.Int),
    stream: true,
  }),
  Rpc.make('watchAll', { success: Schema.Int, stream: true }),
)
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>
declare const queryClient: QueryClient
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ['helpers'] })

const input = { id: 1 } satisfies InferInput<typeof rpc.read>
type ReadData = Assert<Equal<InferQueryData<typeof rpc.read>, number | null>>
type ReadMutationData = Assert<Equal<InferMutationData<typeof rpc.read>, number | undefined>>
type ReadMutationError = Assert<
  Equal<InferMutationError<typeof rpc.read>, InferQueryError<typeof rpc.read>>
>
type PingInput = Assert<Equal<InferInput<typeof rpc.ping>, void>>
type PingQueryData = Assert<Equal<InferQueryData<typeof rpc.ping>, null>>
type PingMutationData = Assert<Equal<InferMutationData<typeof rpc.ping>, void>>
type WatchInput = Assert<Equal<InferInput<typeof rpc.watch>, { readonly channel: string }>>
type WatchAllInput = Assert<Equal<InferInput<typeof rpc.watchAll>, void>>
type WatchData = Assert<
  Equal<InferQueryData<typeof rpc.watch, 'streamed'>, readonly (number | undefined)[]>
>
type WatchLiveData = Assert<Equal<InferQueryData<typeof rpc.watch, 'live'>, number | null>>
type InfiniteReadData = Assert<
  Equal<InferQueryData<typeof rpc.read, 'infinite'>, InfiniteData<number | null, unknown>>
>
type BranchInput = Assert<Equal<InferInput<typeof rpc>, never>>
const broadGroup = RpcGroup.make(
  Rpc.make('unknownRead', { payload: Schema.Unknown, success: Schema.String }),
  Rpc.make('anyRead', { payload: Schema.Any, success: Schema.String }),
  Rpc.make('optionalRead', {
    payload: Schema.Union([Schema.String, Schema.Void]),
    success: Schema.String,
  }),
  Rpc.make('unknownWatch', { payload: Schema.Unknown, success: Schema.String, stream: true }),
  Rpc.make('anyWatch', { payload: Schema.Any, success: Schema.String, stream: true }),
  Rpc.make('optionalWatch', {
    payload: Schema.Union([Schema.String, Schema.Void]),
    success: Schema.String,
    stream: true,
  }),
)
declare const broad: RpcQueryUtils<typeof broadGroup, readonly ['broad']>
type UnknownInput = Assert<Equal<InferInput<typeof broad.unknownRead>, unknown>>
type AnyInput = Assert<Equal<InferInput<typeof broad.anyRead>, any>>
type OptionalInput = Assert<Equal<InferInput<typeof broad.optionalRead>, string | void>>
type UnknownStreamInput = Assert<Equal<InferInput<typeof broad.unknownWatch>, unknown>>
type AnyStreamInput = Assert<Equal<InferInput<typeof broad.anyWatch>, any>>
type OptionalStreamInput = Assert<Equal<InferInput<typeof broad.optionalWatch>, string | void>>
withQueryPolicy(broad.unknownRead, 'query', { retry: false })({ input: { id: 1 } })
withQueryPolicy(broad.anyRead, 'query', { retry: false })({ input: { id: 1 } })
withQueryPolicy(broad.optionalRead, 'query', { retry: false })({ input: undefined })
withQueryPolicy(broad.unknownWatch, 'streamed', { retry: false })({ input: { id: 1 } })
withQueryPolicy(broad.anyWatch, 'live', { retry: false })({ input: { id: 1 } })
withQueryPolicy(broad.optionalWatch, 'live', { retry: false })({ input: 'Ada' })
type StreamMutationData = Assert<Equal<InferMutationData<typeof rpc.watch>, never>>
type StreamMutationError = Assert<Equal<InferMutationError<typeof rpc.watch>, never>>
const prefix = viewPrefix(rpc.read, 'query')
type ViewPrefix = Assert<Equal<typeof prefix, readonly ['helpers', 'rpc', 'read', 'query']>>
type UntaggedPrefix = Assert<
  Equal<typeof dataTagSymbol extends keyof typeof prefix ? true : false, false>
>
const prefixCacheData = queryClient.getQueryData(prefix)
type PrefixCacheData = Assert<Equal<typeof prefixCacheData, unknown>>
queryClient.invalidateQueries({ queryKey: prefix })
viewPrefix(rpc.watch, 'streamed') satisfies readonly ['helpers', 'rpc', 'watch', 'streamed']
// @ts-expect-error RPC leaves have no metadata view
type MissingMetadata = InferQueryData<typeof rpc.read, 'metadata'>
// @ts-expect-error Buffered RPC leaves have no live view
type MissingLiveError = InferQueryError<typeof rpc.read, 'live'>
// @ts-expect-error Streaming RPC leaves have no ordinary query view
type MissingStreamQuery = InferQueryData<typeof rpc.watch, 'query'>
// @ts-expect-error A payload constructor still requires its declared id
const missingInput: InferInput<typeof rpc.read> = {}

const policy = {
  retry: (count, error) => {
    error satisfies EffectRpcQueryError<'missing'>
    return count < 2
  },
  staleTime: (query) => {
    query.state.data satisfies number | null | undefined
    return query.state.data === undefined ? 0 : 1_000
  },
  refetchInterval: (query) => (query.state.data === null ? false : 1_000),
} satisfies QueryPolicy<typeof rpc.read>
const read = withQueryPolicy(rpc.read, 'query', policy)
const selected = read({ input, select: (data) => `${data}` })
useQuery(selected).data satisfies string | undefined
useSuspenseQuery(selected).data satisfies string
queryClient.getQueryData(selected.queryKey) satisfies number | null | undefined
const initialized = read({ input, initialData: 1, select: (data) => `${data}` })
useQuery(initialized).data satisfies string
const skipped = read({ input: skipToken })
skipped.queryFn satisfies SkipToken
declare const conditionalInput: InferInput<typeof rpc.read> | SkipToken
const conditional = read({ input: conditionalInput })
// @ts-expect-error A conditional function cannot be used as a Suspense query
useSuspenseQuery(conditional)

const infinite = withQueryPolicy(rpc.read, 'infinite', {
  staleTime: (query) => {
    query.state.data satisfies InfiniteData<number | null, unknown> | undefined
    return 1_000
  },
})({
  input: (page: number) => ({ id: page }),
  initialPageParam: 0,
  getNextPageParam: (_last, _all, page) => {
    page satisfies number
    return page + 1
  },
  select: (data) => data.pages.length,
})
useInfiniteQuery(infinite).data satisfies number | undefined
queryClient.getQueryData(infinite.queryKey) satisfies
  | InfiniteData<number | null, number>
  | undefined

const live = withQueryPolicy(rpc.watch, 'live', {
  retry: (_count, error) => error._tag !== 'EffectRpcQueryEmptyStreamError',
})({ input: { channel: 'one' }, select: (data) => `${data}` })
useQuery(live).data satisfies string | undefined
withQueryPolicy(rpc.watchAll, 'streamed', { gcTime: 60_000 })({ maxChunks: 2 })

const mutationPolicy = {
  onSuccess: (data, variables, result, context) => {
    data satisfies number | undefined
    variables satisfies InferInput<typeof rpc.read>
    result satisfies unknown
    return context.client.invalidateQueries({ queryKey: rpc.read.key() })
  },
  onError: (error, variables) => {
    error satisfies EffectRpcQueryError<'missing'>
    variables satisfies InferInput<typeof rpc.read>
  },
} satisfies MutationPolicy<typeof rpc.read>
const mutate = withMutationPolicy(rpc.read, mutationPolicy)
const mutation = mutate({
  onMutate: (variables) => ({ previous: variables.id }),
  onSuccess: (_data, _variables, result) => {
    result.previous satisfies number
  },
  onError: (_error, _variables, result) => {
    result?.previous satisfies number | undefined
  },
})
useMutation(mutation).mutate(input)
// @ts-expect-error Mutation variables retain their required fields
useMutation(mutation).mutate({})

const api = HttpApi.make('helpers').add(
  HttpApiGroup.make('items').add(
    HttpApiEndpoint.get('read', '/items/:id', {
      params: { id: Schema.Int },
      success: Schema.Void,
    }),
    HttpApiEndpoint.post('upload', '/upload', {
      payload: Schema.Struct({ name: Schema.String }).pipe(HttpApiSchema.asMultipart()),
      success: Schema.Int,
    }),
    HttpApiEndpoint.get('watch', '/watch', {
      success: HttpApiSchema.StreamSse({ data: Schema.Int }),
    }),
  ),
)
declare const httpClient: HttpApiClient.ForApi<typeof api>
const http = createHttpApiQueryUtils(api, { client: httpClient, keyPrefix: ['helpers'] })
type HttpInput = Assert<
  Equal<
    Omit<InferInput<typeof http.items.read>, 'responseMode' | 'sseOptions'>,
    { readonly params: { readonly id: number } }
  >
>
type HttpReadData = Assert<Equal<InferQueryData<typeof http.items.read>, null>>
type MetadataData = Assert<
  Equal<
    InferQueryData<typeof http.items.read, 'metadata'>,
    {
      readonly data: null
      readonly status: number
      readonly headers: Readonly<Record<string, string>>
    }
  >
>
type MultipartInput = Assert<
  Equal<
    Omit<InferInput<typeof http.items.upload>, 'responseMode' | 'sseOptions'>,
    { readonly payload: FormData }
  >
>
type HttpStreamInput = Assert<Equal<InferInput<typeof http.items.watch>, void>>
withQueryPolicy(http.items.read, 'metadata', {
  staleTime: (query) => (query.state.data?.status === 200 ? 30_000 : 0),
  retry: (_count, error) => {
    error satisfies EffectHttpApiQueryError<unknown>
    return false
  },
})({ input: { params: { id: 1 } } })
withMutationPolicy(http.items.upload, {
  onSuccess: (data, variables) => {
    data satisfies number
    variables.payload satisfies FormData
  },
})()
// @ts-expect-error Multipart leaves have no query policy
withQueryPolicy(http.items.upload, 'query', {})
// @ts-expect-error Stream leaves have no mutation policy
withMutationPolicy(rpc.watch, {})
// @ts-expect-error There is no metadata view on an RPC leaf
withQueryPolicy(rpc.read, 'metadata', {})
declare const unresolvedLeaf: typeof rpc.read | typeof rpc.watch
// @ts-expect-error The chosen view must exist on every possible leaf
withQueryPolicy(unresolvedLeaf, 'query', {})
// @ts-expect-error A view prefix also requires a view on every possible leaf
viewPrefix(unresolvedLeaf, 'live')
// @ts-expect-error A buffered leaf has no live view prefix
viewPrefix(rpc.read, 'live')
// @ts-expect-error Branches have no query view prefix
viewPrefix(rpc, 'query')
// @ts-expect-error Multipart leaves have no query view prefix
viewPrefix(http.items.upload, 'query')
// @ts-expect-error Inputs belong to each builder invocation
withQueryPolicy(rpc.read, 'query', { input })
// @ts-expect-error A policy cannot replace the generated key
withQueryPolicy(rpc.read, 'query', { queryKey: ['owned'] })
// @ts-expect-error A policy cannot replace the generated function
withQueryPolicy(rpc.read, 'query', { queryFn: () => Promise.resolve(1) })
// @ts-expect-error QueryClient owns hashing
withQueryPolicy(rpc.read, 'query', { queryKeyHashFn: () => 'custom' })
// @ts-expect-error Projection inference remains local
withQueryPolicy(rpc.read, 'query', { select: (value: number | null) => `${value}` })
// @ts-expect-error Initial data inference remains local
withQueryPolicy(rpc.read, 'query', { initialData: 1 })
// @ts-expect-error Placeholder data inference remains local
withQueryPolicy(rpc.read, 'query', { placeholderData: 1 })
// @ts-expect-error RPC request options remain local
withQueryPolicy(rpc.read, 'query', { rpcOptions: { headers: { authorization: 'token' } } })
// @ts-expect-error Stream identity remains local
withQueryPolicy(rpc.watch, 'streamed', { maxChunks: 10 })
// @ts-expect-error SSE decoding remains local
withQueryPolicy(http.items.watch, 'live', { sseOptions: {} })
// @ts-expect-error Page setup remains local
withQueryPolicy(rpc.read, 'infinite', { initialPageParam: 0 })
// @ts-expect-error Shared callbacks cannot assume a call-site optimistic result
withMutationPolicy(rpc.read, { onSuccess: (_data, _variables, result) => result.previous })
// @ts-expect-error Optimistic context inference remains local
withMutationPolicy(rpc.read, { onMutate: () => ({ previous: 1 }) })
// @ts-expect-error A mutation policy cannot replace the generated key
withMutationPolicy(rpc.read, { mutationKey: ['owned'] })
// @ts-expect-error Request-local adapter options are supplied to the bound builder
withMutationPolicy(rpc.read, { rpcOptions: {} })
// @ts-expect-error A typed callback cannot change the leaf's mutation output
withMutationPolicy(rpc.read, { onSuccess: (_data: string) => {} })
// @ts-expect-error A typed callback cannot change the leaf's query error
withQueryPolicy(rpc.read, 'query', { retry: (_count, _error: { different: true }) => false })
const injected = { retry: false, queryHash: 'custom' }
// @ts-expect-error Exclusions also apply to stored policy objects
withQueryPolicy(rpc.read, 'query', injected)
