import { signal } from '@angular/core'
import {
  injectInfiniteQuery,
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental'
import { QueryClient, type InfiniteData } from '@tanstack/query-core'
import { createInfiniteQuery, createMutation, createQuery } from '@tanstack/svelte-query'
import { Context, Effect, Schema } from 'effect'
import {
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  skipToken,
  type EffectHttpApiQueryEmptyStreamError,
  type EffectHttpApiQueryError,
  type EffectRpcQueryEmptyStreamError,
  type EffectRpcQueryError,
  type RunPromiseExit,
} from 'effect-api-query'
import type { HttpClientError } from 'effect/http'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  type HttpApiClient,
} from 'effect/http-api'
import { Rpc, RpcGroup, type RpcClient } from 'effect/rpc'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

class Encoding extends Context.Service<Encoding, { readonly suffix: string }>()(
  'Framework/Encoding',
) {}
const Payload = Schema.Struct({ id: Schema.Int })
const ServicefulPayload = Payload.pipe(
  Schema.middlewareEncoding<typeof Payload, Encoding>((encode) =>
    Effect.flatMap(Encoding, () => encode),
  ),
)
const User = Schema.Struct({ id: Schema.Int, name: Schema.String })
const Read = Rpc.make('users.read', {
  payload: ServicefulPayload,
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
declare const readyRpc: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>, 'transport'>
declare const runner: RunPromiseExit<Encoding>
const rpc = createRpcQueryUtils(group, {
  client: readyRpc,
  keyPrefix: ['framework', 'rpc-owner'],
  runPromiseExit: runner,
  keyEncoders: { 'users.read': (input) => input.id },
})
// @ts-expect-error The encoding service remains a runner requirement.
createRpcQueryUtils(group, {
  client: readyRpc,
  keyPrefix: ['missing'],
  keyEncoders: { 'users.read': (input) => input.id },
})
const client = new QueryClient()
const selected = rpc.users.read.queryOptions({
  input: { id: 1 },
  initialData: { id: 1, name: 'initial' },
  select: (user) => user.name,
  retry: (attempt, error) => {
    error satisfies EffectRpcQueryError<'missing' | 'transport'>
    return attempt < 2
  },
  enabled: (query) => query.state.data?.id !== 0,
})
const svelteSelected = createQuery(() => selected)
const angularSelected = injectQuery(() => selected)
true satisfies Assert<Equal<typeof svelteSelected.data, string>>
true satisfies Assert<Equal<ReturnType<typeof angularSelected.data>, string>>
true satisfies Assert<
  Equal<typeof svelteSelected.error, EffectRpcQueryError<'missing' | 'transport'> | null>
>
true satisfies Assert<
  Equal<
    ReturnType<typeof angularSelected.error>,
    EffectRpcQueryError<'missing' | 'transport'> | null
  >
>
const cached = client.getQueryData(selected.queryKey)
true satisfies Assert<Equal<typeof cached, typeof User.Type | undefined>>
const id = signal(1)
const svelteReactive = createQuery(() =>
  rpc.users.read.queryOptions({ input: { id: id() }, select: (user) => user.name }),
)
const angularReactive = injectQuery(() =>
  rpc.users.read.queryOptions({ input: { id: id() }, select: (user) => user.name }),
)
true satisfies Assert<Equal<typeof svelteReactive.data, string | undefined>>
true satisfies Assert<Equal<ReturnType<typeof angularReactive.data>, string | undefined>>
const skipped = rpc.users.read.queryOptions({
  input: skipToken,
  initialData: { id: 1, name: 'initial' },
})
skipped.queryFn satisfies typeof skipToken
const svelteSkipped = createQuery(() => skipped)
true satisfies Assert<Equal<typeof svelteSkipped.data, typeof User.Type>>
const angularSkipped = injectQuery(() => skipped)
true satisfies Assert<Equal<ReturnType<typeof angularSkipped.data>, typeof User.Type | undefined>>
const nativeAngularSkippedOptions: {
  queryKey: readonly ['native-skipped']
  queryFn: typeof skipToken
  initialData: typeof User.Type
} = {
  queryKey: ['native-skipped'],
  queryFn: skipToken,
  initialData: { id: 1, name: 'initial' },
}
const nativeAngularSkipped = injectQuery(() => nativeAngularSkippedOptions)
true satisfies Assert<
  Equal<ReturnType<typeof nativeAngularSkipped.data>, typeof User.Type | undefined>
>
const explicitlyUndefined = rpc.users.read.queryOptions({
  input: { id: 1 },
  initialData: undefined,
})
const possiblyUndefined = rpc.users.read.queryOptions({
  input: { id: 1 },
  initialData: (): typeof User.Type | undefined => client.getQueryData(selected.queryKey),
})
const svelteUndefined = createQuery(() => explicitlyUndefined)
const angularUndefined = injectQuery(() => explicitlyUndefined)
const sveltePossible = createQuery(() => possiblyUndefined)
const angularPossible = injectQuery(() => possiblyUndefined)
true satisfies Assert<Equal<typeof svelteUndefined.data, typeof User.Type | undefined>>
true satisfies Assert<Equal<ReturnType<typeof angularUndefined.data>, typeof User.Type | undefined>>
true satisfies Assert<Equal<typeof sveltePossible.data, typeof User.Type | undefined>>
true satisfies Assert<Equal<ReturnType<typeof angularPossible.data>, typeof User.Type | undefined>>
// @ts-expect-error Svelte expects an accessor around generated plain options.
createQuery(selected)
// @ts-expect-error Angular expects an accessor around generated plain options.
injectQuery(selected)
const conditional = rpc.users.read.queryOptions({
  input: Math.random() > 0.5 ? { id: 1 } : skipToken,
})
createQuery(() => conditional)
injectQuery(() => conditional)
const mutation = rpc.users.read.mutationOptions({
  onMutate: (input) => ({ original: input.id }),
  onSuccess: (user, input, transaction) => {
    user.name satisfies string
    input.id satisfies number
    transaction?.original satisfies number | undefined
  },
})
const svelteMutation = createMutation(() => mutation)
const angularMutation = injectMutation(() => mutation)
svelteMutation.mutate({ id: 1 })
angularMutation.mutate({ id: 1 })
true satisfies Assert<Equal<typeof svelteMutation.data, typeof User.Type | undefined>>
true satisfies Assert<Equal<ReturnType<typeof angularMutation.data>, typeof User.Type | undefined>>
// @ts-expect-error Mutation variables retain the decoded input.
svelteMutation.mutate({ id: 'wrong' })
// @ts-expect-error Mutation variables retain the decoded input.
angularMutation.mutate({ id: 'wrong' })
const infinite = rpc.users.read.infiniteOptions({
  input: (cursor: number) => ({ id: cursor }),
  initialPageParam: 0,
  getNextPageParam: (last, _pages, cursor) => {
    last.name satisfies string
    cursor satisfies number
    return cursor + 1
  },
  initialData: { pages: [{ id: 0, name: 'zero' }], pageParams: [0] },
  select: (value) => value.pages.map((user) => user.name),
})
const svelteInfinite = createInfiniteQuery(() => infinite)
const angularInfinite = injectInfiniteQuery(() => infinite)
true satisfies Assert<Equal<typeof svelteInfinite.data, string[]>>
true satisfies Assert<Equal<ReturnType<typeof angularInfinite.data>, string[]>>
const infiniteCache = client.getQueryData(infinite.queryKey)
true satisfies Assert<
  Equal<typeof infiniteCache, InfiniteData<typeof User.Type, number> | undefined>
>
const history = rpc.users.watch.streamedOptions({
  input: { id: 1 },
  maxChunks: 4,
  initialData: [1],
  select: (values) => values.length,
})
const live = rpc.users.watch.liveOptions({
  input: { id: 1 },
  initialData: null,
  select: (value) => (value === null ? 'empty' : value.toFixed()),
})
const svelteHistory = createQuery(() => history)
const angularHistory = injectQuery(() => history)
const svelteLive = createQuery(() => live)
const angularLive = injectQuery(() => live)
true satisfies Assert<Equal<typeof svelteHistory.data, number>>
true satisfies Assert<Equal<ReturnType<typeof angularHistory.data>, number>>
true satisfies Assert<Equal<typeof svelteLive.data, string>>
true satisfies Assert<Equal<ReturnType<typeof angularLive.data>, string>>
svelteLive.error satisfies
  | EffectRpcQueryError<'closed' | 'transport'>
  | EffectRpcQueryEmptyStreamError
  | null
angularLive.error() satisfies
  | EffectRpcQueryError<'closed' | 'transport'>
  | EffectRpcQueryEmptyStreamError
  | null
const historyCache = client.getQueryData(history.queryKey)
const liveCache = client.getQueryData(live.queryKey)
true satisfies Assert<Equal<typeof historyCache, readonly (number | undefined)[] | undefined>>
true satisfies Assert<Equal<typeof liveCache, number | null | undefined>>
createQuery(() => rpc.users.watch.streamedOptions(skipToken))
injectQuery(() => rpc.users.watch.liveOptions(skipToken))

const api = HttpApi.make('framework').add(
  HttpApiGroup.make('values').add(
    HttpApiEndpoint.get('read', '/values/:id', {
      params: { id: Schema.FiniteFromString },
      success: User,
      error: Schema.Literal('http-missing'),
    }),
    HttpApiEndpoint.get('watch', '/values/watch/:id', {
      params: { id: Schema.FiniteFromString },
      success: HttpApiSchema.StreamSse({ data: Schema.Int, error: Schema.Literal('http-closed') }),
    }),
  ),
)
declare const readyHttp: HttpApiClient.ForApi<typeof api, 'http-transport', Encoding>
const http = createHttpApiQueryUtils(api, {
  client: readyHttp,
  keyPrefix: ['framework', 'http-owner'],
  runPromiseExit: runner,
})
// @ts-expect-error The HTTP client service remains a runner requirement.
createHttpApiQueryUtils(api, { client: readyHttp, keyPrefix: ['missing'] })
const request = { params: { id: 1 } }
const httpQuery = http.values.read.queryOptions({
  input: request,
  initialData: { id: 1, name: 'initial' },
  select: (user) => user.name,
})
const svelteHttp = createQuery(() => httpQuery)
const angularHttp = injectQuery(() => httpQuery)
true satisfies Assert<Equal<typeof svelteHttp.data, string>>
true satisfies Assert<Equal<ReturnType<typeof angularHttp.data>, string>>
const metadata = http.values.read.metadataOptions({
  input: request,
  select: (view) => view.data.name,
})
const svelteMetadata = createQuery(() => metadata)
const angularMetadata = injectQuery(() => metadata)
true satisfies Assert<Equal<typeof svelteMetadata.data, string | undefined>>
true satisfies Assert<Equal<ReturnType<typeof angularMetadata.data>, string | undefined>>
svelteMetadata.error satisfies EffectHttpApiQueryError<
  Schema.SchemaError | HttpClientError.HttpClientError | 'http-missing' | 'http-transport'
> | null
angularMetadata.error() satisfies EffectHttpApiQueryError<
  Schema.SchemaError | HttpClientError.HttpClientError | 'http-missing' | 'http-transport'
> | null
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
createMutation(() => httpMutation).mutate(request)
injectMutation(() => httpMutation).mutate(request)
const httpInfinite = http.values.read.infiniteOptions({
  input: (cursor: number) => ({ params: { id: cursor } }),
  initialPageParam: 0,
  getNextPageParam: (_last, _pages, cursor) => cursor + 1,
  select: (value) => value.pages.map((user) => user.name),
})
createInfiniteQuery(() => httpInfinite).data satisfies string[] | undefined
injectInfiniteQuery(() => httpInfinite).data() satisfies string[] | undefined
const httpHistory = http.values.watch.streamedOptions({
  input: request,
  maxChunks: 3,
  initialData: [1],
  select: (values) => values.length,
})
const httpLive = http.values.watch.liveOptions({
  input: request,
  initialData: 1,
  select: (value) => value.toFixed(),
})
const svelteHttpHistory = createQuery(() => httpHistory)
const angularHttpHistory = injectQuery(() => httpHistory)
const svelteHttpLive = createQuery(() => httpLive)
const angularHttpLive = injectQuery(() => httpLive)
true satisfies Assert<Equal<typeof svelteHttpHistory.data, number>>
true satisfies Assert<Equal<ReturnType<typeof angularHttpHistory.data>, number>>
true satisfies Assert<Equal<typeof svelteHttpLive.data, string>>
true satisfies Assert<Equal<ReturnType<typeof angularHttpLive.data>, string>>
svelteHttpLive.error satisfies
  | EffectHttpApiQueryError<unknown>
  | EffectHttpApiQueryEmptyStreamError
  | null
createQuery(() => http.values.read.queryOptions(skipToken))
injectQuery(() => http.values.read.metadataOptions(skipToken))
createQuery(() => http.values.watch.streamedOptions(skipToken))
injectQuery(() => http.values.watch.liveOptions(skipToken))
