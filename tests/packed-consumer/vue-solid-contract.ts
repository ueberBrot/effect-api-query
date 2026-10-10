import {
  QueryClient,
  type InfiniteData,
  type InferDataFromTag,
  type InferErrorFromTag,
  type QueryKey,
} from '@tanstack/query-core'
import {
  useInfiniteQuery as useSolidInfiniteQuery,
  useMutation as useSolidMutation,
  useQuery as useSolidQuery,
} from '@tanstack/solid-query'
import {
  useInfiniteQuery as useVueInfiniteQuery,
  useMutation as useVueMutation,
  useQuery as useVueQuery,
} from '@tanstack/vue-query'
import { Context, Effect, Schema, SchemaTransformation } from 'effect'
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  skipToken,
  type CreateHttpApiQueryUtilsOptions,
  type CreateRpcQueryUtilsOptions,
  type EffectHttpApiQueryEmptyStreamError,
  type EffectHttpApiQueryError,
  type EffectRpcQueryEmptyStreamError,
  type EffectRpcQueryError,
  type RunPromiseExit,
} from 'effect-api-query'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  type HttpApiClient,
} from 'effect/http-api'
import { Rpc, type RpcClient, RpcGroup } from 'effect/rpc'
import { createSignal } from 'solid-js'
import { computed, ref } from 'vue'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
class Encoder extends Context.Service<Encoder, { readonly suffix: string }>()(
  'Framework/Encoder',
) {}
class Decoder extends Context.Service<Decoder, { readonly factor: number }>()(
  'Framework/Decoder',
) {}
const Payload = Schema.Struct({ id: Schema.Int })
const EncodedPayload = Payload.pipe(
  Schema.middlewareEncoding<typeof Payload, Encoder>((encoding) =>
    Effect.flatMap(Encoder, () => encoding),
  ),
)
const User = Schema.Struct({ id: Schema.Int, name: Schema.String })
const Read = Rpc.make('users.read', {
  payload: EncodedPayload,
  success: User,
  error: Schema.Literal('missing'),
})
const Watch = Rpc.make('users.watch', {
  payload: { id: Schema.Int },
  success: Schema.UndefinedOr(Schema.Int),
  error: Schema.Literal('closed'),
  stream: true,
})
const group = RpcGroup.make(Read, Watch)
declare const rpcClient: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>, 'transport'>
declare const rpcRunner: RunPromiseExit<Encoder>
const rpc = createRpcQueryUtils(group, {
  client: rpcClient,
  keyPrefix: ['framework', 'rpc-owner'],
  runPromiseExit: rpcRunner,
  keyEncoders: {
    'users.read': (input) => {
      input.id satisfies number
      return input.id
    },
  },
})
type RpcRunner = CreateRpcQueryUtilsOptions<
  typeof group,
  readonly ['framework'],
  'transport'
>['runPromiseExit']
true satisfies Assert<Equal<RpcRunner, RunPromiseExit<Encoder>>>
// @ts-expect-error Encoding requires the caller's serviceful runner.
createRpcQueryUtils(group, {
  client: rpcClient,
  keyPrefix: ['missing'],
  keyEncoders: { 'users.read': (input) => input.id },
})
const client = new QueryClient()
const rpcOptions = rpc.users.read.queryOptions({
  input: { id: 1 },
  initialData: { id: 1, name: 'initial' },
  select: (user) => user.name,
  staleTime: Infinity,
  gcTime: 60_000,
  retry: (attempt, error) => {
    error satisfies EffectRpcQueryError<'missing' | 'transport'>
    return attempt < 2
  },
})
const cached = client.getQueryData(rpcOptions.queryKey)
true satisfies Assert<Equal<typeof cached, typeof User.Type | undefined>>
const vueSelected = useVueQuery<
  typeof User.Type,
  EffectRpcQueryError<'missing' | 'transport'>,
  string
>(rpcOptions)
true satisfies Assert<Equal<typeof vueSelected.data.value, string>>
vueSelected.error.value satisfies EffectRpcQueryError<'missing' | 'transport'> | null
const solidSelected = useSolidQuery(() => rpcOptions)
true satisfies Assert<Equal<typeof solidSelected.data, string>>
true satisfies Assert<
  Equal<typeof solidSelected.error, EffectRpcQueryError<'missing' | 'transport'> | null>
>
const vueId = ref(1)
const vueReactiveOptions = computed(() =>
  rpc.users.read.queryOptions({ input: { id: vueId.value }, select: (user) => user.name }),
)
const vueReactive = useVueQuery<
  typeof User.Type,
  EffectRpcQueryError<'missing' | 'transport'>,
  string
>(vueReactiveOptions)
true satisfies Assert<Equal<typeof vueReactive.data.value, string | undefined>>
const [solidId] = createSignal(1)
const solidReactive = useSolidQuery(() =>
  rpc.users.read.queryOptions({ input: { id: solidId() }, select: (user) => user.name }),
)
true satisfies Assert<Equal<typeof solidReactive.data, string | undefined>>
const skipped = rpc.users.read.queryOptions({
  input: skipToken,
  initialData: { id: 1, name: 'initial' },
})
skipped.queryFn satisfies typeof skipToken
const vueSkipped = useVueQuery<typeof User.Type, EffectRpcQueryError<'missing' | 'transport'>>(
  skipped,
)
const solidSkipped = useSolidQuery(() => skipped)
vueSkipped.data.value satisfies typeof User.Type | undefined
true satisfies Assert<Equal<typeof solidSkipped.data, typeof User.Type>>
const conditional = rpc.users.read.queryOptions({
  input: Math.random() > 0.5 ? { id: 1 } : skipToken,
})
true satisfies Assert<Equal<Extract<keyof typeof conditional, 'initialData' | 'enabled'>, never>>
useVueQuery<typeof User.Type, EffectRpcQueryError<'missing' | 'transport'>>(conditional)
useSolidQuery(() => conditional)
const vueEnabled = rpc.users.read.queryOptions({
  input: { id: 1 },
  enabled: () => vueId.value > 0,
})
useVueQuery<typeof User.Type, EffectRpcQueryError<'missing' | 'transport'>>(vueEnabled)
const coreEnabled = rpc.users.read.queryOptions({
  input: { id: 1 },
  enabled: (query) => {
    query.state.data satisfies typeof User.Type | undefined
    query.state.error satisfies EffectRpcQueryError<'missing' | 'transport'> | null
    return query.state.data?.id !== 0
  },
})
useSolidQuery(() => coreEnabled)
// @ts-expect-error Vue's enabled getter receives no Core Query argument.
useVueQuery<typeof User.Type, EffectRpcQueryError<'missing' | 'transport'>>(coreEnabled)
const maybeSeed = rpc.users.read.queryOptions({
  input: { id: 1 },
  initialData: () => client.getQueryData(rpc.users.read.queryKey({ id: 1 })),
})
const vueMaybeSeed = useVueQuery<typeof User.Type, EffectRpcQueryError<'missing' | 'transport'>>(
  maybeSeed,
)
true satisfies Assert<Equal<typeof vueMaybeSeed.data.value, typeof User.Type | undefined>>
// @ts-expect-error Solid's pinned overloads require defined or undefined initialData.
useSolidQuery(() => maybeSeed)
const explicitUndefinedSeed = rpc.users.read.queryOptions({
  input: { id: 1 },
  initialData: undefined,
})
const solidUndefinedSeed = useSolidQuery(() => explicitUndefinedSeed)
true satisfies Assert<Equal<typeof solidUndefinedSeed.data, typeof User.Type | undefined>>
const mutationOptions = rpc.users.read.mutationOptions({
  onMutate: (input) => {
    input.id satisfies number
    return { owner: 'original' as const }
  },
  onSuccess: (data, input, transaction) => {
    data satisfies typeof User.Type
    input.id satisfies number
    transaction?.owner satisfies 'original' | undefined
  },
})
const vueMutation = useVueMutation(mutationOptions)
const solidMutation = useSolidMutation(() => mutationOptions)
vueMutation.mutate({ id: 1 })
solidMutation.mutate({ id: 1 })
vueMutation.data.value satisfies typeof User.Type | undefined
true satisfies Assert<Equal<typeof solidMutation.data, typeof User.Type | undefined>>
// @ts-expect-error The installed Vue mutation retains the declared payload.
vueMutation.mutate({ id: 'wrong' })
// @ts-expect-error The installed Solid mutation retains the declared payload.
solidMutation.mutate({ id: 'wrong' })
const infiniteOptions = rpc.users.read.infiniteOptions({
  input: (cursor: number) => ({ id: cursor }),
  initialPageParam: 0,
  getNextPageParam: (last, _pages, lastParam) => {
    last.name satisfies string
    lastParam satisfies number
    return lastParam + 1
  },
  initialData: { pages: [{ id: 0, name: 'zero' }], pageParams: [0] },
  select: (value) => value.pages.map((user) => user.name),
})
const vueInfinite = useVueInfiniteQuery<
  typeof User.Type,
  EffectRpcQueryError<'missing' | 'transport'>,
  string[],
  QueryKey,
  number
>(infiniteOptions)
const solidInfinite = useSolidInfiniteQuery(() => infiniteOptions)
vueInfinite.data.value satisfies string[] | undefined
true satisfies Assert<Equal<typeof solidInfinite.data, string[]>>
const infiniteCache = client.getQueryData(infiniteOptions.queryKey)
true satisfies Assert<
  Equal<typeof infiniteCache, InfiniteData<typeof User.Type, number> | undefined>
>
const accumulated = rpc.users.watch.streamedOptions({
  input: { id: 1 },
  maxChunks: 4,
  refetchMode: 'append',
  select: (values) => values.length,
  initialData: [1],
})
const live = rpc.users.watch.liveOptions({
  input: { id: 1 },
  initialData: null,
  select: (value) => (value === null ? 'empty' : value.toFixed()),
})
const vueHistory = useVueQuery<
  readonly (number | undefined)[],
  EffectRpcQueryError<'closed' | 'transport'>,
  number
>(accumulated)
const solidHistory = useSolidQuery(() => accumulated)
true satisfies Assert<Equal<typeof vueHistory.data.value, number>>
true satisfies Assert<Equal<typeof solidHistory.data, number>>
const vueLive = useVueQuery<
  number | null,
  EffectRpcQueryError<'closed' | 'transport'> | EffectRpcQueryEmptyStreamError,
  string
>(live)
const solidLive = useSolidQuery(() => live)
true satisfies Assert<Equal<typeof vueLive.data.value, string>>
true satisfies Assert<Equal<typeof solidLive.data, string>>
solidLive.error satisfies
  | EffectRpcQueryError<'closed' | 'transport'>
  | EffectRpcQueryEmptyStreamError
  | null
const liveCache = client.getQueryData(live.queryKey)
true satisfies Assert<Equal<typeof liveCache, number | null | undefined>>
const historyCache = client.getQueryData(accumulated.queryKey)
true satisfies Assert<Equal<typeof historyCache, readonly (number | undefined)[] | undefined>>
useVueQuery<
  number | null,
  EffectRpcQueryError<'closed' | 'transport'> | EffectRpcQueryEmptyStreamError
>(rpc.users.watch.liveOptions(skipToken))
useSolidQuery(() => rpc.users.watch.streamedOptions(skipToken))

const Decoded = Schema.Finite.pipe(
  Schema.decodeTo(
    Schema.Finite,
    SchemaTransformation.transformEffect({
      decode: (value) => Decoder.pipe(Effect.map(({ factor }) => value * factor)),
      encode: Effect.succeed,
    }),
  ),
)
const api = HttpApi.make('framework').add(
  HttpApiGroup.make('values').add(
    HttpApiEndpoint.get('read', '/values/:id', {
      params: { id: Schema.FiniteFromString },
      success: User,
      error: Schema.Literal('http-missing'),
    }),
    HttpApiEndpoint.get('watch', '/values/watch/:id', {
      params: { id: Schema.FiniteFromString },
      success: HttpApiSchema.StreamSse({ data: Decoded, error: Schema.Literal('http-closed') }),
    }),
  ),
)
declare const httpClient: HttpApiClient.ForApi<typeof api, 'http-transport', 'http-service'>
declare const httpRunner: RunPromiseExit<Decoder | 'http-service'>
const http = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ['framework', 'http-owner'],
  runPromiseExit: httpRunner,
  keyEncoders: {
    values: {
      read: (request) => {
        request.params.id satisfies number
        return request.params.id
      },
    },
  },
})
type HttpRunner = CreateHttpApiQueryUtilsOptions<
  typeof api,
  readonly ['framework'],
  typeof httpClient
>['runPromiseExit']
true satisfies Assert<Equal<HttpRunner, RunPromiseExit<Decoder | 'http-service'>>>
// @ts-expect-error Decoding and client services remain application-owned.
createHttpApiQueryUtils(api, { client: httpClient, keyPrefix: ['missing'] })
const request = { params: { id: 1 } }
const httpOptions = http.values.read.queryOptions({
  input: request,
  initialData: { id: 1, name: 'initial' },
  select: (user) => user.name,
})
const vueHttp = useVueQuery<
  InferDataFromTag<unknown, typeof httpOptions.queryKey>,
  InferErrorFromTag<Error, typeof httpOptions.queryKey>,
  string
>(httpOptions)
const solidHttp = useSolidQuery(() => httpOptions)
true satisfies Assert<Equal<typeof vueHttp.data.value, string>>
true satisfies Assert<Equal<typeof solidHttp.data, string>>
const metadata = http.values.read.metadataOptions({
  input: request,
  select: (view) => view.data.name,
})
const vueMetadata = useVueQuery<
  InferDataFromTag<unknown, typeof metadata.queryKey>,
  InferErrorFromTag<Error, typeof metadata.queryKey>,
  string
>(metadata)
const solidMetadata = useSolidQuery(() => metadata)
true satisfies Assert<Equal<typeof vueMetadata.data.value, string | undefined>>
true satisfies Assert<Equal<typeof solidMetadata.data, string | undefined>>
const metadataState = client.getQueryState(metadata.queryKey)
type HttpError = NonNullable<typeof metadataState>['error']
solidMetadata.error satisfies HttpError
vueMetadata.error.value satisfies HttpError
const metadataCache = client.getQueryData(metadata.queryKey)
metadataCache?.data satisfies typeof User.Type | undefined
metadataCache?.status satisfies number | undefined
metadataCache?.headers satisfies Readonly<Record<string, string>> | undefined
const httpMutation = http.values.read.mutationOptions({
  onSuccess: (value, input) => {
    value.name satisfies string
    input.params.id satisfies number
  },
})
useVueMutation(httpMutation).mutate(request)
useSolidMutation(() => httpMutation).mutate(request)
const httpInfinite = http.values.read.infiniteOptions({
  input: (cursor: number) => ({ params: { id: cursor } }),
  initialPageParam: 0,
  getNextPageParam: (_last, _pages, cursor) => cursor + 1,
  select: (value) => value.pages.map((user) => user.name),
})
useVueInfiniteQuery<
  typeof User.Type,
  InferErrorFromTag<Error, typeof httpInfinite.queryKey>,
  string[],
  QueryKey,
  number
>(httpInfinite).data.value satisfies string[] | undefined
useSolidInfiniteQuery(() => httpInfinite).data satisfies string[] | undefined
const httpHistory = http.values.watch.streamedOptions({
  input: request,
  maxChunks: 3,
  select: (values) => values.length,
  initialData: [1],
})
const httpLive = http.values.watch.liveOptions({
  input: request,
  initialData: 1,
  select: (value) => value.toFixed(),
})
const vueHttpHistory = useVueQuery<
  InferDataFromTag<unknown, typeof httpHistory.queryKey>,
  InferErrorFromTag<Error, typeof httpHistory.queryKey>,
  number
>(httpHistory)
const solidHttpHistory = useSolidQuery(() => httpHistory)
const vueHttpLive = useVueQuery<
  InferDataFromTag<unknown, typeof httpLive.queryKey>,
  InferErrorFromTag<Error, typeof httpLive.queryKey>,
  string
>(httpLive)
const solidHttpLive = useSolidQuery(() => httpLive)
true satisfies Assert<Equal<typeof vueHttpHistory.data.value, number>>
true satisfies Assert<Equal<typeof solidHttpHistory.data, number>>
true satisfies Assert<Equal<typeof vueHttpLive.data.value, string>>
true satisfies Assert<Equal<typeof solidHttpLive.data, string>>
solidHttpLive.error satisfies
  | EffectHttpApiQueryError<unknown>
  | EffectHttpApiQueryEmptyStreamError
  | null
useVueQuery<typeof User.Type, InferErrorFromTag<Error, typeof httpOptions.queryKey>>(
  http.values.read.queryOptions(skipToken),
)
useSolidQuery(() => http.values.read.metadataOptions(skipToken))
useVueQuery<readonly number[], InferErrorFromTag<Error, typeof httpHistory.queryKey>>(
  http.values.watch.streamedOptions(skipToken),
)
useSolidQuery(() => http.values.watch.liveOptions(skipToken))
