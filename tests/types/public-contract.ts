// fallow-ignore-file code-duplication
// This fixture stays self-contained so built-declaration checks exercise the full public contract.
import {
  type InfiniteData,
  MutationObserver,
  QueryClient,
  QueryObserver,
  InfiniteQueryObserver,
  skipToken as queryCoreSkipToken,
} from '@tanstack/query-core'
import {
  skipToken as reactQuerySkipToken,
  useInfiniteQuery,
  usePrefetchInfiniteQuery,
  usePrefetchQuery,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Context, Effect, Schema } from 'effect'
import type { Redacted } from 'effect'
import {
  createRpcQueryUtils,
  EffectRpcQueryEmptyStreamError,
  EffectRpcQueryError,
  skipToken,
  type CreateRpcQueryUtilsOptions,
  type EffectRpcQueryConfigErrorCode,
  type EffectRpcQueryKeyErrorCode,
  type JsonValue,
  type KeyEncoder,
  type QueryData,
  type RpcQueryUtils,
  type RunPromiseExit,
  type SkipToken,
} from 'effect-api-query'
import { Rpc, RpcClient, RpcGroup, RpcMiddleware } from 'effect/unstable/rpc'

class AuthMiddleware extends RpcMiddleware.Service<AuthMiddleware>()('AuthMiddleware', {
  error: Schema.Literal('unauthorized'),
}) {}

const GetUser = Rpc.make('users.get', {
  payload: {
    id: Schema.Finite,
    locale: Schema.String.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed('en')),
    ),
  },
  success: Schema.Struct({ id: Schema.Finite, name: Schema.String }),
  error: Schema.Literal('not-found'),
})

const Ping = Rpc.make('health.ping', { success: Schema.Void })
const ListPages = Rpc.make('users.pages', {
  payload: {
    cursor: Schema.Int,
    locale: Schema.String.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed('en')),
    ),
  },
  success: Schema.Struct({
    nextCursor: Schema.NullOr(Schema.Int),
    users: Schema.Array(Schema.Struct({ id: Schema.Int, name: Schema.String })),
  }),
  error: Schema.Literal('page-failure'),
})
const Secure = Rpc.make('admin.secure', {
  success: Schema.String,
}).middleware(AuthMiddleware)
const Watch = Rpc.make('events.watch', {
  payload: {
    channel: Schema.String,
    locale: Schema.String.pipe(
      Schema.optionalKey,
      Schema.withConstructorDefault(Effect.succeed('en')),
    ),
  },
  success: Schema.String,
  error: Schema.Literal('watch-failure'),
  stream: true,
})
  .setError(Schema.Literal('watch-rpc-failure'))
  .middleware(AuthMiddleware)
const AuditWatch = Rpc.make('events.audit.watch', {
  success: Schema.String,
  stream: true,
})
const FindProject = Rpc.make('projects.by-id.find', {
  payload: { id: Schema.String },
  success: Schema.Struct({ id: Schema.String }),
})
const ProjectHealth = Rpc.make('projects.health.ping', { success: Schema.Void })
const ProjectWatch = Rpc.make('projects.watch', {
  success: Schema.String,
  stream: true,
})
const BracketOnly = Rpc.make('billing-history.list all', {
  payload: { accountId: Schema.String },
  success: Schema.Array(Schema.String),
})

class EncodingService extends Context.Service<EncodingService, { readonly suffix: string }>()(
  'EncodingService',
) {}

const BasePayload = Schema.Struct({ value: Schema.String })
const ServicefulPayload = BasePayload.pipe(
  Schema.middlewareEncoding<typeof BasePayload, EncodingService>((encoding) =>
    Effect.flatMap(EncodingService, () => encoding),
  ),
)
const Serviceful = Rpc.make('encoding.serviceful', {
  payload: ServicefulPayload,
  success: Schema.String,
})
const Secret = Rpc.make('secrets.read', {
  payload: { secret: Schema.Redacted(Schema.String) },
  success: Schema.String,
})
const SecretList = Rpc.make('secrets.list', {
  payload: Schema.Array(Schema.Union([Schema.String, Schema.Redacted(Schema.String)])),
  success: Schema.String,
})

interface RecursiveSecret {
  readonly children: readonly RecursiveSecret[]
  readonly secret: Redacted.Redacted<string>
}
const RecursiveSecret = Schema.Struct({
  children: Schema.Array(
    Schema.suspend((): Schema.Codec<RecursiveSecret, unknown> => RecursiveSecret),
  ),
  secret: Schema.RedactedFromValue(Schema.String),
})
const recursiveSecretGroup = RpcGroup.make(
  Rpc.make('recursive.read', {
    payload: RecursiveSecret,
    success: Schema.String,
  }),
)
declare const recursiveSecretClient: RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof recursiveSecretGroup>
>
// @ts-expect-error recursive redacted payloads require a safe key encoder
createRpcQueryUtils(recursiveSecretGroup, { client: recursiveSecretClient, keyPrefix: ['app'] })
createRpcQueryUtils(recursiveSecretGroup, {
  client: recursiveSecretClient,
  keyPrefix: ['app'],
  keyEncoders: { 'recursive.read': () => 'subject' },
})

const nestedSecretGroup = RpcGroup.make(
  Rpc.make('nested.read', {
    payload: Schema.Struct({
      value: Schema.Union([
        Schema.String,
        Schema.Struct({ value: Schema.String, secret: Schema.RedactedFromValue(Schema.String) }),
      ]),
    }),
    success: Schema.String,
  }),
)
declare const nestedSecretClient: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof nestedSecretGroup>>
// @ts-expect-error nested redacted payloads require a safe encoder even when assignable to an ancestor
createRpcQueryUtils(nestedSecretGroup, { client: nestedSecretClient, keyPrefix: ['app'] })

class ClassPayload extends Schema.Class<ClassPayload>('ClassPayload')({
  id: Schema.Finite,
}) {}
const ClassRead = Rpc.make('classes.read', {
  payload: ClassPayload,
  success: Schema.String,
})

const group = RpcGroup.make(
  GetUser,
  ListPages,
  Ping,
  Secure,
  Watch,
  AuditWatch,
  FindProject,
  ProjectHealth,
  ProjectWatch,
  BracketOnly,
)
type Rpcs = RpcGroup.Rpcs<typeof group>

declare const client: RpcClient.RpcClient.Flat<Rpcs>

const keyPrefix = ['app'] as const
const options: CreateRpcQueryUtilsOptions<typeof group, typeof keyPrefix> = {
  client,
  keyPrefix,
}

// @ts-expect-error key prefixes must contain at least one value
createRpcQueryUtils(group, { client, keyPrefix: [] as const })
// @ts-expect-error key prefixes accept only strict JSON values
createRpcQueryUtils(group, { client, keyPrefix: ['app', new Date(0)] as const })

const utils = createRpcQueryUtils(group, options)
export type PublicContractUtils = typeof utils
const typedUtils: RpcQueryUtils<typeof group, typeof keyPrefix> = utils
void typedUtils

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Condition extends true> = Condition
type ExpectedLeafInterface =
  | 'infiniteKey'
  | 'infiniteOptions'
  | 'key'
  | 'mutationKey'
  | 'mutationOptions'
  | 'queryKey'
  | 'queryOptions'
type ExactLeafInterface = Assert<
  Equal<keyof (typeof utils)['projects']['by-id']['find'], ExpectedLeafInterface>
>

const exactLeafInterface: ExactLeafInterface = true
type ExpectedStreamLeafInterface =
  | 'key'
  | 'liveKey'
  | 'liveOptions'
  | 'streamedKey'
  | 'streamedOptions'
type ExactStreamLeafInterface = Assert<
  Equal<keyof (typeof utils)['events']['watch'], ExpectedStreamLeafInterface>
>
const exactStreamLeafInterface: ExactStreamLeafInterface = true
const projectKey = utils.projects['by-id'].find.queryKey({ id: 'project-1' })
const projectPing = utils.projects.health.ping.queryOptions()
const bracketOnly = utils['billing-history']['list all'].queryOptions({
  input: { accountId: 'account-1' },
})
void [exactLeafInterface, exactStreamLeafInterface, projectKey, projectPing, bracketOnly]

const jsonValue: JsonValue = { nested: [true, null, 1, 'value'] }
const keyEncoder: KeyEncoder<typeof GetUser> = (payload) => ({ id: payload.id })
const classKeyEncoder: KeyEncoder<typeof ClassRead> = (payload) => {
  payload satisfies ClassPayload
  return { id: payload.id }
}
const runPromiseExit: RunPromiseExit = Effect.runPromiseExit
const queryData: QueryData<void> = null
const configCode: EffectRpcQueryConfigErrorCode = 'InvalidMaxChunks'
const keyCode: EffectRpcQueryKeyErrorCode = 'InvalidKeyValue'
void [jsonValue, keyEncoder, classKeyEncoder, runPromiseExit, queryData, configCode, keyCode]

createRpcQueryUtils(group, {
  client,
  keyEncoders: {
    // @ts-expect-error payloadless operations have no payload identity to override
    'health.ping': () => null,
  },
  keyPrefix,
})

createRpcQueryUtils(group, {
  client,
  keyEncoders: {
    'events.watch': (payload) => {
      payload satisfies { readonly channel: string; readonly locale?: string }
      return { channel: payload.channel, locale: payload.locale ?? 'en' }
    },
  },
  keyPrefix,
})

createRpcQueryUtils(group, {
  client,
  keyEncoders: {
    // @ts-expect-error encoder configuration is keyed by literal payload-bearing RPC tags
    'users.missing': () => null,
  },
  keyPrefix,
})

createRpcQueryUtils(group, {
  client,
  keyEncoders: {
    // @ts-expect-error key encoders must return synchronously
    'users.get': async (payload) => ({ id: payload.id }),
  },
  keyPrefix,
})

createRpcQueryUtils(group, {
  client,
  keyEncoders: {
    // @ts-expect-error Effect-returning key encoders are outside the public contract
    'users.get': (payload) => Effect.succeed({ id: payload.id }),
  },
  keyPrefix,
})

const queryClient = new QueryClient()

const streamedOptions = utils.events.watch.streamedOptions({
  maxChunks: 50,
  input: { channel: 'news' },
  meta: { source: 'fixture' },
  networkMode: 'offlineFirst',
  refetchMode: 'append',
  retry: (_count, error) => {
    error satisfies EffectRpcQueryError<'unauthorized' | 'watch-failure' | 'watch-rpc-failure'>
    return false
  },
  select: (values) => values.join(', '),
})
const streamedHook = useQuery(streamedOptions)
const streamedHookData: string | undefined = streamedHook.data
streamedHook.error satisfies EffectRpcQueryError<
  'unauthorized' | 'watch-failure' | 'watch-rpc-failure'
> | null
const streamedResult: Promise<string> = queryClient.query(streamedOptions)
const streamedKey = utils.events.watch.streamedKey({ channel: 'news' })
streamedKey satisfies readonly ['app', 'rpc', 'events', 'watch', 'streamed', JsonValue]
const cachedStream = queryClient.getQueryData(utils.events.watch.streamedKey({ channel: 'news' }))
cachedStream satisfies ReadonlyArray<string> | undefined
queryClient.invalidateQueries({ queryKey: streamedKey })
queryClient.refetchQueries({ queryKey: streamedKey })
void [streamedHookData, streamedResult]

const liveOptions = utils.events.watch.liveOptions({
  input: { channel: 'news' },
  select: (value) => value.length,
})
const liveHook = useQuery(liveOptions)
const liveHookData: number | undefined = liveHook.data
liveHook.error satisfies
  | EffectRpcQueryEmptyStreamError
  | EffectRpcQueryError<'unauthorized' | 'watch-failure' | 'watch-rpc-failure'>
  | null
const liveResult: Promise<number> = queryClient.query(liveOptions)
const liveKey = utils.events.watch.liveKey({ channel: 'news' })
liveKey satisfies readonly ['app', 'rpc', 'events', 'watch', 'live', JsonValue]
const cachedLive = queryClient.getQueryData(liveKey)
cachedLive satisfies string | undefined
void [liveHookData, liveResult]

const initializedStream = useQuery(
  utils.events.watch.streamedOptions({
    initialData: ['initial'],
    input: { channel: 'news' },
    select: (values) => values.join(', '),
  }),
)
initializedStream.data satisfies string
const initializedLive = useQuery(
  utils.events.watch.liveOptions({
    initialData: 'initial',
    input: { channel: 'news' },
    select: (value) => value.length,
  }),
)
initializedLive.data satisfies number

declare const clientFailureClient: RpcClient.RpcClient.Flat<Rpcs, 'client-failure'>
const clientFailureUtils = createRpcQueryUtils<typeof group, typeof keyPrefix, 'client-failure'>(
  group,
  { client: clientFailureClient, keyPrefix },
)
clientFailureUtils.events.watch.streamedOptions({
  input: { channel: 'news' },
  retry: (_count, error) => {
    error satisfies EffectRpcQueryError<
      'client-failure' | 'unauthorized' | 'watch-failure' | 'watch-rpc-failure'
    >
    return false
  },
})

const skippedStreamed = utils.events.watch.streamedOptions(skipToken)
skippedStreamed.queryFn satisfies typeof queryCoreSkipToken
const skippedLive = utils.events.watch.liveOptions(skipToken)
skippedLive.queryFn satisfies typeof queryCoreSkipToken
useQuery(skippedStreamed)
useQuery(skippedLive)
// @ts-expect-error suspense queries cannot use a skipped stream
useSuspenseQuery(skippedStreamed)
// @ts-expect-error suspense queries cannot use a skipped live stream
useSuspenseQuery(skippedLive)

const payloadlessStreamed = utils.events.audit.watch.streamedOptions()
const payloadlessLive = utils.events.audit.watch.liveOptions()
queryClient.query(payloadlessStreamed)
queryClient.query(payloadlessLive)

// @ts-expect-error payload-bearing streaming queries require input or skipToken
utils.events.watch.streamedOptions({})
// @ts-expect-error payload-bearing live queries require input or skipToken
utils.events.watch.liveOptions({})
// @ts-expect-error payloadless streaming queries omit input
utils.events.audit.watch.streamedOptions({ input: undefined })
// @ts-expect-error payloadless live queries omit input
utils.events.audit.watch.liveOptions({ input: undefined })
// @ts-expect-error the package owns the streamed query function
utils.events.watch.streamedOptions({ input: { channel: 'news' }, queryFn: async () => [] })
// @ts-expect-error the package owns the live query key
utils.events.watch.liveOptions({ input: { channel: 'news' }, queryKey: ['custom'] })
// @ts-expect-error live queries do not accept accumulated-stream refetch modes
utils.events.watch.liveOptions({ input: { channel: 'news' }, refetchMode: 'append' })

const infiniteOptions = utils.users.pages.infiniteOptions({
  getNextPageParam: (lastPage, allPages, lastPageParam, allPageParams) => {
    lastPage satisfies {
      readonly nextCursor: number | null
      readonly users: ReadonlyArray<{ readonly id: number; readonly name: string }>
    }
    allPages satisfies ReadonlyArray<typeof lastPage>
    lastPageParam satisfies number
    allPageParams satisfies ReadonlyArray<number>
    return lastPage.nextCursor ?? undefined
  },
  getPreviousPageParam: (_firstPage, _allPages, firstPageParam, allPageParams) => {
    firstPageParam satisfies number
    allPageParams satisfies ReadonlyArray<number>
    return firstPageParam > 0 ? firstPageParam - 1 : undefined
  },
  initialPageParam: 0,
  input: (cursor: number) => ({ cursor }),
  meta: { source: 'fixture' },
  networkMode: 'offlineFirst',
  retry: (_count, error) => {
    error satisfies EffectRpcQueryError<'page-failure'>
    return false
  },
  select: (data) => data.pages.flatMap((page) => page.users.map((user) => user.name)),
})
const infiniteHook = useInfiniteQuery(infiniteOptions)
const infiniteHookData: ReadonlyArray<string> | undefined = infiniteHook.data
infiniteHook.error satisfies EffectRpcQueryError<'page-failure'> | null
void infiniteHookData

const fetchableInfiniteOptions = utils.users.pages.infiniteOptions({
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  initialPageParam: 0,
  input: (cursor: number) => ({ cursor }),
})
const fetchedPages: Promise<
  InfiniteData<
    {
      readonly nextCursor: number | null
      readonly users: ReadonlyArray<{ readonly id: number; readonly name: string }>
    },
    number
  >
> = queryClient.infiniteQuery(fetchableInfiniteOptions)
void fetchedPages
usePrefetchInfiniteQuery(fetchableInfiniteOptions)

const infiniteKey = utils.users.pages.infiniteKey({ cursor: 0 })
infiniteKey satisfies readonly ['app', 'rpc', 'users', 'pages', 'infinite', JsonValue]
const cachedPages = queryClient.getQueryData(fetchableInfiniteOptions.queryKey)
cachedPages?.pageParams satisfies ReadonlyArray<number> | undefined
cachedPages?.pages satisfies
  | ReadonlyArray<{
      readonly nextCursor: number | null
      readonly users: ReadonlyArray<{ readonly id: number; readonly name: string }>
    }>
  | undefined
queryClient.invalidateQueries({ queryKey: infiniteKey })
queryClient.refetchQueries({ queryKey: fetchableInfiniteOptions.queryKey })

const skippedInfinite = utils.users.pages.infiniteOptions({
  getNextPageParam: () => undefined,
  initialPageParam: 0,
  input: skipToken,
})
skippedInfinite.queryFn satisfies typeof queryCoreSkipToken
useInfiniteQuery(skippedInfinite)
// @ts-expect-error suspense infinite queries cannot use the skip sentinel
useSuspenseInfiniteQuery(skippedInfinite)
// @ts-expect-error prefetch-only infinite hooks cannot use the skip sentinel
usePrefetchInfiniteQuery(skippedInfinite)

const payloadlessInfinite = utils.health.ping.infiniteOptions({
  getNextPageParam: () => undefined,
  initialPageParam: 0,
})
const payloadlessPages: Promise<InfiniteData<null, number>> =
  queryClient.infiniteQuery(payloadlessInfinite)
void payloadlessPages

// @ts-expect-error payload-bearing infinite queries require an input mapper or skipToken
utils.users.pages.infiniteOptions({ getNextPageParam: () => undefined, initialPageParam: 0 })
utils.health.ping.infiniteOptions({
  getNextPageParam: () => undefined,
  initialPageParam: 0,
  // @ts-expect-error payloadless infinite queries do not accept an input mapper
  input: () => undefined,
})
const buildPages = utils.users.pages.infiniteOptions<number, never>
const validPageOptions = {
  getNextPageParam: () => undefined,
  initialPageParam: 0,
  input: (cursor: number) => ({ cursor }),
}
// @ts-expect-error infinite input mappers must return the RPC payload constructor input
buildPages({ ...validPageOptions, input: () => ({ cursor: 'invalid' }) })
// @ts-expect-error the package owns the infinite-query function
buildPages({ ...validPageOptions, queryFn: async () => ({ nextCursor: null, users: [] }) })
// @ts-expect-error the package owns the infinite-query key
buildPages({ ...validPageOptions, queryKey: ['custom'] })

const selected = utils.users.get.queryOptions({
  input: { id: 1 },
  initialData: { id: 1, name: 'Ada' },
  select: (user) => user.name,
})
const definedInitialData:
  | { readonly id: number; readonly name: string }
  | (() => { readonly id: number; readonly name: string }) = selected.initialData
void definedInitialData
const selectedResult: Promise<string> = queryClient.query(selected)
void selectedResult

const selectedHook = useQuery(selected)
const selectedHookData: string = selectedHook.data
selectedHook.error satisfies EffectRpcQueryError<'not-found'> | null
void selectedHookData

const queryOptions = utils.users.get.queryOptions({
  enabled: (query) => query.state.data?.id !== 0,
  gcTime: 60_000,
  input: { id: 1 },
  meta: { source: 'fixture' },
  networkMode: 'offlineFirst',
  notifyOnChangeProps: ['data', 'error'],
  placeholderData: (previous) => previous,
  refetchInterval: (query) => (query.state.data === undefined ? 1_000 : false),
  refetchOnMount: (query) => query.state.data === undefined,
  retry: (_count, error) => {
    error satisfies EffectRpcQueryError<'not-found'>
    return false
  },
  retryDelay: (_attempt, error) => {
    error satisfies EffectRpcQueryError<'not-found'>
    return 0
  },
  select: (user) => user.name,
  staleTime: (query) => (query.state.data?.name === 'Ada' ? Infinity : 0),
  structuralSharing: false,
})
type ExactQueryHashInput = Assert<
  Equal<Parameters<typeof queryOptions.queryKeyHashFn>[0], typeof queryOptions.queryKey>
>
const exactQueryHashInput: ExactQueryHashInput = true

const queryHook = useQuery(queryOptions)
const queryHookData: string | undefined = queryHook.data
queryHook.error satisfies EffectRpcQueryError<'not-found'> | null
const suspenseHook = useSuspenseQuery(queryOptions)
const suspenseData: string = suspenseHook.data
suspenseHook.error satisfies EffectRpcQueryError<'not-found'> | null
usePrefetchQuery(queryOptions)

void [exactQueryHashInput, queryHookData, suspenseData]

const possiblyInitialized = utils.users.get.queryOptions({
  input: { id: 1, locale: 'de' },
  initialData: () => undefined,
})
const possiblyUndefinedInitialData:
  | { readonly id: number; readonly name: string }
  | (() => { readonly id: number; readonly name: string } | undefined)
  | undefined = possiblyInitialized.initialData
void possiblyUndefinedInitialData

declare const directInitialData: QueryData<Rpc.Success<typeof GetUser>> | undefined
const possiblyDirectlyInitialized = utils.users.get.queryOptions({
  input: { id: 1 },
  initialData: directInitialData,
})
const possiblyDirectInitialData:
  | { readonly id: number; readonly name: string }
  | (() => { readonly id: number; readonly name: string } | undefined)
  | undefined = possiblyDirectlyInitialized.initialData
void possiblyDirectInitialData

const encoderGroup = RpcGroup.make(Serviceful, Secret)
type EncoderRpcs = RpcGroup.Rpcs<typeof encoderGroup>
declare const encoderClient: RpcClient.RpcClient.Flat<EncoderRpcs>
declare const encoderRunner: RunPromiseExit<EncodingService>

// @ts-expect-error serviceful and redacted payloads require explicit key encoders
const missingEncoderOptions: CreateRpcQueryUtilsOptions<typeof encoderGroup, typeof keyPrefix> = {
  client: encoderClient,
  keyPrefix,
  runPromiseExit: encoderRunner,
}
void missingEncoderOptions

const encoderOptions: CreateRpcQueryUtilsOptions<typeof encoderGroup, typeof keyPrefix> = {
  client: encoderClient,
  keyEncoders: {
    'encoding.serviceful': (payload) => payload,
    'secrets.read': () => ({ redacted: true }),
  },
  keyPrefix,
  runPromiseExit: encoderRunner,
}
createRpcQueryUtils(encoderGroup, encoderOptions)

const secretListGroup = RpcGroup.make(SecretList)
type SecretListRpcs = RpcGroup.Rpcs<typeof secretListGroup>
declare const secretListClient: RpcClient.RpcClient.Flat<SecretListRpcs>

// @ts-expect-error redacted values nested in a top-level array require an encoder
const missingSecretListEncoder: CreateRpcQueryUtilsOptions<
  typeof secretListGroup,
  typeof keyPrefix
> = {
  client: secretListClient,
  keyPrefix,
}
void missingSecretListEncoder

const cachedUser: { readonly id: number; readonly name: string } | undefined =
  queryClient.getQueryData(utils.users.get.queryKey({ id: 1 }))
void cachedUser

const concreteQueryKey = utils.users.get.queryKey({ id: 1 })
concreteQueryKey satisfies readonly ['app', 'rpc', 'users', 'get', 'query', JsonValue]
const cachedState = queryClient.getQueryState(concreteQueryKey)
cachedState?.error satisfies EffectRpcQueryError<'not-found'> | null | undefined

const skipped = utils.users.get.queryOptions(skipToken)
skipped.queryFn satisfies typeof queryCoreSkipToken
const typedSkipToken: SkipToken = skipped.queryFn
void typedSkipToken
type ExactSkippedQueryHashInput = Assert<
  Equal<Parameters<typeof skipped.queryKeyHashFn>[0], typeof skipped.queryKey>
>
const exactSkippedQueryHashInput: ExactSkippedQueryHashInput = true
void exactSkippedQueryHashInput
const skippedHook = useQuery(skipped)
const skippedData: { readonly id: number; readonly name: string } | undefined = skippedHook.data
skippedHook.error satisfies EffectRpcQueryError<'not-found'> | null
void skippedData

// @ts-expect-error suspense queries cannot use the skip sentinel
useSuspenseQuery(skipped)
// @ts-expect-error prefetch-only hooks cannot use the skip sentinel
usePrefetchQuery(skipped)

const pingQuery: Promise<null> = queryClient.query(utils.health.ping.queryOptions())
void pingQuery

const pingMutation = new MutationObserver(queryClient, utils.health.ping.mutationOptions())
const pingMutationResult: Promise<void> = pingMutation.mutate(undefined)
void pingMutationResult

const getMutationOptions = utils.users.get.mutationOptions<{
  readonly previousName: string
}>({
  gcTime: 60_000,
  onError: (error, variables, onMutateResult) => {
    error satisfies EffectRpcQueryError<'not-found'>
    variables satisfies { readonly id: number; readonly locale?: string }
    onMutateResult satisfies { readonly previousName: string } | undefined
  },
  onMutate: (variables) => {
    variables satisfies { readonly id: number; readonly locale?: string }
    return { previousName: 'Grace' }
  },
  onSuccess: (data, variables, onMutateResult) => {
    data satisfies { readonly id: number; readonly name: string }
    variables satisfies { readonly id: number; readonly locale?: string }
    onMutateResult satisfies { readonly previousName: string }
  },
  throwOnError: (error) => {
    error satisfies EffectRpcQueryError<'not-found'>
    return false
  },
})
getMutationOptions.mutationKey satisfies readonly ['app', 'rpc', 'users', 'get', 'mutation']
getMutationOptions.throwOnError satisfies
  | boolean
  | ((error: EffectRpcQueryError<'not-found'>) => boolean)
  | undefined
const getMutation = new MutationObserver(queryClient, getMutationOptions)
const getMutationResult: Promise<{ readonly id: number; readonly name: string }> =
  getMutation.mutate({ id: 1 })
void getMutationResult

// @ts-expect-error mutation variables arrive at execution, not option construction
utils.users.get.mutationOptions({ input: { id: 1 } })
utils.users.get.mutationOptions({
  // @ts-expect-error the package owns the mutation function
  mutationFn: async () => ({ id: 1, name: 'Grace' }),
})
utils.users.get.mutationOptions({
  // @ts-expect-error the package owns the mutation key
  mutationKey: ['custom'],
})

utils.admin.secure.queryOptions({
  retry: (_count, error) => {
    error satisfies EffectRpcQueryError<'unauthorized'>
    return false
  },
})

// @ts-expect-error payload-bearing queries require input or skipToken
utils.users.get.queryOptions({})
// @ts-expect-error payloadless queries do not accept an input field
utils.health.ping.queryOptions({ input: undefined })
// @ts-expect-error payloadless queries do not accept the skip sentinel
utils.health.ping.queryOptions(skipToken)
// @ts-expect-error key builders never accept the skip sentinel
utils.users.get.queryKey(skipToken)
// @ts-expect-error mutation builders never accept the skip sentinel
utils.users.get.mutationOptions(skipToken)
// @ts-expect-error the package owns the query function
utils.users.get.queryOptions({
  input: { id: 1 },
  queryFn: queryCoreSkipToken,
})
// @ts-expect-error the package owns the query key
utils.users.get.queryOptions({
  input: { id: 1 },
  queryKey: ['custom'],
})
// @ts-expect-error the package owns the per-call query key hash function
utils.users.get.queryOptions({
  input: { id: 1 },
  queryKeyHashFn: JSON.stringify,
})
void utils.projects.watch.streamedOptions({})
// @ts-expect-error streaming leaves do not expose unary query builders
void utils.projects.watch.queryOptions
// @ts-expect-error unary leaves do not expose streaming query builders
void utils.projects['by-id'].find.streamedOptions
// @ts-expect-error leaves expose no direct execution helper
void utils.projects['by-id'].find.call
// @ts-expect-error leaves expose no mutation cancellation helper
void utils.users.get.cancelMutation

if (skipToken !== queryCoreSkipToken || skipToken !== reactQuerySkipToken) {
  throw new Error('skipToken must preserve Query Core and React Query identity')
}

// Object-form skipping preserves inference through Query Core and React Query.
const skippedQueryObject = utils.users.get.queryOptions({
  input: skipToken,
  select: (user) => user.name,
  staleTime: (query) => {
    query.queryKey satisfies readonly ['app', 'rpc', 'users', 'get', 'query']
    return 30_000
  },
  retry: (_count, error) => {
    error satisfies EffectRpcQueryError<'not-found'>
    return false
  },
})
const skippedQueryResult = useQuery(skippedQueryObject)
skippedQueryResult.data satisfies string | undefined
// @ts-expect-error no initial data guarantees a value
skippedQueryResult.data satisfies string
new QueryObserver(queryClient, skippedQueryObject).getCurrentResult().data satisfies
  | string
  | undefined
skippedQueryObject.queryFn satisfies SkipToken
skippedQueryObject.queryKey satisfies readonly ['app', 'rpc', 'users', 'get', 'query']
// @ts-expect-error package input is consumed
skippedQueryObject.input
// @ts-expect-error suspense requires an executable query function
useSuspenseQuery(skippedQueryObject)
// @ts-expect-error prefetch-only hooks require an executable query function
usePrefetchQuery(skippedQueryObject)

const skippedStreamObject = utils.events.watch.streamedOptions({
  maxChunks: 50,
  input: skipToken,
  refetchMode: 'append',
  select: (values) => values.join(', '),
})
useQuery(skippedStreamObject).data satisfies string | undefined
new QueryObserver(queryClient, skippedStreamObject).getCurrentResult().data satisfies
  | string
  | undefined
skippedStreamObject.queryFn satisfies SkipToken
skippedStreamObject.queryKey satisfies readonly ['app', 'rpc', 'events', 'watch', 'streamed']
// @ts-expect-error stream policy is consumed
skippedStreamObject.refetchMode
// @ts-expect-error package input is consumed
skippedStreamObject.input
// @ts-expect-error suspense requires an executable query function
useSuspenseQuery(skippedStreamObject)
// @ts-expect-error prefetch-only hooks require an executable query function
usePrefetchQuery(skippedStreamObject)

const skippedLiveObject = utils.events.watch.liveOptions({
  input: skipToken,
  select: (value) => value.length,
})
const skippedLiveResult = useQuery(skippedLiveObject)
skippedLiveResult.data satisfies number | undefined
skippedLiveResult.error satisfies
  | EffectRpcQueryEmptyStreamError
  | EffectRpcQueryError<'unauthorized' | 'watch-failure' | 'watch-rpc-failure'>
  | null
new QueryObserver(queryClient, skippedLiveObject).getCurrentResult().data satisfies
  | number
  | undefined
skippedLiveObject.queryFn satisfies SkipToken
skippedLiveObject.queryKey satisfies readonly ['app', 'rpc', 'events', 'watch', 'live']
// @ts-expect-error package input is consumed
skippedLiveObject.input
// @ts-expect-error suspense requires an executable query function
useSuspenseQuery(skippedLiveObject)
// @ts-expect-error prefetch-only hooks require an executable query function
usePrefetchQuery(skippedLiveObject)

const skippedInfiniteObject = utils.users.pages.infiniteOptions({
  input: skipToken,
  initialPageParam: 0,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  select: (data) => data.pages.flatMap((page) => page.users).length,
})
useInfiniteQuery(skippedInfiniteObject).data satisfies number | undefined
new InfiniteQueryObserver(queryClient, skippedInfiniteObject).getCurrentResult().data satisfies
  | number
  | undefined
skippedInfiniteObject.queryFn satisfies SkipToken
// @ts-expect-error package input is consumed
skippedInfiniteObject.input

useQuery(
  utils.users.get.queryOptions({
    input: skipToken,
    initialData: { id: 1, name: 'Ada' },
    select: (value) => value.name,
  }),
).data satisfies string | undefined
useQuery(
  utils.users.get.queryOptions({
    input: skipToken,
    initialData: () => ({ id: 1, name: 'Ada' }),
    select: (value) => value.name,
  }),
).data satisfies string | undefined
declare const optionalQueryInitial: () => { id: number; name: string } | undefined
const optionalQueryResult = useQuery(
  utils.users.get.queryOptions({ input: skipToken, initialData: optionalQueryInitial }),
)
// @ts-expect-error an initial-data function may return undefined
optionalQueryResult.data satisfies { id: number; name: string }
useQuery(
  utils.events.watch.streamedOptions({
    input: skipToken,
    initialData: ['first'],
    select: (values) => values.join(', '),
  }),
).data satisfies string | undefined
useQuery(
  utils.events.watch.streamedOptions({
    input: skipToken,
    initialData: () => ['first'],
    select: (values) => values.join(', '),
  }),
).data satisfies string | undefined
declare const optionalStreamedInitial: () => ReadonlyArray<string> | undefined
const optionalStreamedResult = useQuery(
  utils.events.watch.streamedOptions({ input: skipToken, initialData: optionalStreamedInitial }),
)
// @ts-expect-error an initial-data function may return undefined
optionalStreamedResult.data satisfies ReadonlyArray<string>
useQuery(
  utils.events.watch.liveOptions({
    input: skipToken,
    initialData: 'first',
    select: (value) => value.length,
  }),
).data satisfies number | undefined
useQuery(
  utils.events.watch.liveOptions({
    input: skipToken,
    initialData: () => 'first',
    select: (value) => value.length,
  }),
).data satisfies number | undefined
declare const optionalLiveInitial: () => string | undefined
const optionalLiveResult = useQuery(
  utils.events.watch.liveOptions({ input: skipToken, initialData: optionalLiveInitial }),
)
// @ts-expect-error an initial-data function may return undefined
optionalLiveResult.data satisfies string
// @ts-expect-error skipping does not widen the supported builder inputs
utils.health.ping.queryOptions({ input: skipToken })
utils.health.ping.infiniteOptions({
  // @ts-expect-error payloadless infinite queries have no input
  input: skipToken,
  initialPageParam: 0,
  getNextPageParam: () => undefined,
})
// @ts-expect-error skipping does not widen the supported builder inputs
utils.events.audit.watch.streamedOptions({ input: skipToken })
// @ts-expect-error skipping does not widen the supported builder inputs
utils.events.audit.watch.liveOptions({ input: skipToken })
// @ts-expect-error skipping does not widen the supported builder inputs
utils.events.audit.watch.streamedOptions(skipToken)
// @ts-expect-error skipping does not widen the supported builder inputs
utils.events.audit.watch.liveOptions(skipToken)
// @ts-expect-error skipping does not widen the supported builder inputs
utils.users.get.infiniteKey(skipToken)
// @ts-expect-error skipping does not widen the supported builder inputs
utils.events.watch.streamedKey(skipToken)
// @ts-expect-error skipping does not widen the supported builder inputs
utils.events.watch.liveKey(skipToken)
// @ts-expect-error skipping does not widen the supported builder inputs
utils.events.watch.liveOptions({ input: skipToken, refetchMode: 'append' })
// @ts-expect-error skipping does not widen the supported builder inputs
utils.users.get.queryOptions({ input: skipToken, queryKey: [] })
// @ts-expect-error skipping does not widen the supported builder inputs
utils.events.watch.streamedOptions({ input: skipToken, queryFn: skipToken })
// @ts-expect-error skipping does not widen the supported builder inputs
utils.events.watch.liveOptions({ input: skipToken, queryKeyHashFn: () => '' })

const initializedSkippedQuery = utils.users.get.queryOptions({
  input: skipToken,
  initialData: { id: 1, name: 'Ada' },
})
initializedSkippedQuery.initialData satisfies
  | { readonly id: number; readonly name: string }
  | (() => { readonly id: number; readonly name: string })
const initializedSkippedStream = utils.events.watch.streamedOptions({
  input: skipToken,
  initialData: () => ['first'],
})
initializedSkippedStream.initialData satisfies ReadonlyArray<string> | (() => ReadonlyArray<string>)
const initializedSkippedLive = utils.events.watch.liveOptions({
  input: skipToken,
  initialData: 'first',
})
initializedSkippedLive.initialData satisfies string | (() => string)
// @ts-expect-error React Query's defined-data overload excludes skipToken
useQuery(initializedSkippedQuery).data satisfies { readonly id: number; readonly name: string }
// @ts-expect-error React Query's defined-data overload excludes skipToken
useQuery(initializedSkippedStream).data satisfies ReadonlyArray<string>
// @ts-expect-error React Query's defined-data overload excludes skipToken
useQuery(initializedSkippedLive).data satisfies string

// @ts-expect-error accumulated-stream policy is consumed before returning Query Core options
streamedOptions.maxChunks
// @ts-expect-error skipped options also consume the accumulation bound
skippedStreamObject.maxChunks
// @ts-expect-error live queries retain only the latest value
utils.events.watch.liveOptions({ input: { channel: 'news' }, maxChunks: 2 })
// @ts-expect-error skipped live queries have no accumulation policy
utils.events.watch.liveOptions({ input: skipToken, maxChunks: 2 })
// @ts-expect-error accumulation bounds are numeric
utils.events.watch.streamedOptions({ input: { channel: 'news' }, maxChunks: '2' })
utils.events.audit.watch.streamedOptions({ maxChunks: 2, initialData: [] })
utils.events.watch.streamedOptions({ input: skipToken, maxChunks: 2, initialData: [] })

declare const conditionalStreamInput: { readonly channel: string } | typeof skipToken
// @ts-expect-error streaming builders retain exact-input and exact-skip overloads
utils.events.watch.streamedOptions({ input: conditionalStreamInput })
// @ts-expect-error live builders retain exact-input and exact-skip overloads
utils.events.watch.liveOptions({ input: conditionalStreamInput })

declare const conditionalUserId: number | undefined
const conditionalUserOptions = utils.users.get.queryOptions({
  input: conditionalUserId === undefined ? skipToken : { id: conditionalUserId },
  refetchInterval: (query) => {
    query.queryKey satisfies
      | readonly ['app', 'rpc', 'users', 'get', 'query']
      | readonly ['app', 'rpc', 'users', 'get', 'query', JsonValue]
    return false
  },
  select: (user) => user.name,
  staleTime: 30_000,
})
useQuery(conditionalUserOptions).data satisfies string | undefined
new QueryObserver(queryClient, conditionalUserOptions).getCurrentResult().data satisfies
  | string
  | undefined
// @ts-expect-error conditional query functions may be skipped
useSuspenseQuery(conditionalUserOptions)
// @ts-expect-error conditional query functions may be skipped
usePrefetchQuery(conditionalUserOptions)

// @ts-expect-error package input is consumed for conditional options
conditionalUserOptions.input
useQuery(conditionalUserOptions).error satisfies EffectRpcQueryError<'not-found'> | null
const initializedConditionalUser = utils.users.get.queryOptions({
  input: conditionalUserId === undefined ? skipToken : { id: conditionalUserId },
  initialData: { id: 1, name: 'Ada' },
  select: (user) => user.name,
})
initializedConditionalUser.initialData satisfies
  | { readonly id: number; readonly name: string }
  | (() => { readonly id: number; readonly name: string })
useQuery(initializedConditionalUser).data satisfies string | undefined

// Request-local inputs retain inference and stay out of the returned Query Core contract.
const unaryRpcOptions = {
  headers: { 'x-request-id': 'fixture' },
  context: Context.empty(),
} satisfies import('effect-api-query').UnaryRpcOptions
const streamingRpcOptions = {
  ...unaryRpcOptions,
  streamBufferSize: 8,
} satisfies import('effect-api-query').StreamingRpcOptions
const requestQuery = utils.users.get.queryOptions({
  input: { id: 1 },
  rpcOptions: unaryRpcOptions,
  select: (user) => user.name,
})
useQuery(requestQuery).data satisfies string | undefined
const requestDefined = utils.users.get.queryOptions({
  input: { id: 1 },
  rpcOptions: unaryRpcOptions,
  initialData: { id: 1, name: 'Ada' },
  select: (user) => user.name,
})
useQuery(requestDefined).data satisfies string
const requestInfinite = utils.users.pages.infiniteOptions({
  input: (cursor: number) => ({ cursor }),
  initialPageParam: 0,
  getNextPageParam: (page) => page.nextCursor,
  rpcOptions: unaryRpcOptions,
})
useInfiniteQuery(requestInfinite).data satisfies
  | InfiniteData<
      {
        readonly nextCursor: number | null
        readonly users: readonly { readonly id: number; readonly name: string }[]
      },
      number
    >
  | undefined
const requestMutation = utils.users.get.mutationOptions({
  rpcOptions: unaryRpcOptions,
  onMutate: (user) => user.id,
})
requestMutation.mutationFn({ id: 1 }) satisfies Promise<{
  readonly id: number
  readonly name: string
}>
const requestStreamed = utils.events.watch.streamedOptions({
  input: { channel: 'news' },
  rpcOptions: streamingRpcOptions,
  select: (values) => values.length,
})
useQuery(requestStreamed).data satisfies number | undefined
const requestLive = utils.events.watch.liveOptions({
  input: { channel: 'news' },
  rpcOptions: streamingRpcOptions,
  initialData: 'ready',
  select: (value) => value.length,
})
useQuery(requestLive).data satisfies number
utils.health.ping.queryOptions({ rpcOptions: unaryRpcOptions })
utils.health.ping.infiniteOptions({
  rpcOptions: unaryRpcOptions,
  initialPageParam: 0,
  getNextPageParam: () => undefined,
})
utils.health.ping.mutationOptions({ rpcOptions: unaryRpcOptions })
utils.events.audit.watch.streamedOptions({ rpcOptions: streamingRpcOptions })
utils.events.audit.watch.liveOptions({ rpcOptions: streamingRpcOptions })
const requestSkipped = utils.users.get.queryOptions({
  input: skipToken,
  rpcOptions: unaryRpcOptions,
})
const requestSkippedInfinite = utils.users.pages.infiniteOptions({
  input: skipToken,
  rpcOptions: unaryRpcOptions,
  initialPageParam: 0,
  getNextPageParam: () => undefined,
})
const requestSkippedStreamed = utils.events.watch.streamedOptions({
  input: skipToken,
  rpcOptions: streamingRpcOptions,
})
const requestSkippedLive = utils.events.watch.liveOptions({
  input: skipToken,
  rpcOptions: streamingRpcOptions,
})
type RequestOutputs =
  | typeof requestQuery
  | typeof requestInfinite
  | typeof requestMutation
  | typeof requestStreamed
  | typeof requestLive
  | typeof requestSkipped
  | typeof requestSkippedInfinite
  | typeof requestSkippedStreamed
  | typeof requestSkippedLive
type OutputKeys<T> = T extends unknown ? keyof T : never
true satisfies Assert<Equal<Extract<OutputKeys<RequestOutputs>, 'rpcOptions'>, never>>
// @ts-expect-error unary requests do not have a stream buffer
utils.users.get.queryOptions({ input: { id: 1 }, rpcOptions: { streamBufferSize: 8 } })
const discardedInfiniteRequest = {
  input: (cursor: number) => ({ cursor }),
  initialPageParam: 0,
  getNextPageParam: () => undefined,
  rpcOptions: { discard: true },
}
// @ts-expect-error infinite requests require the unary result
utils.users.pages.infiniteOptions(discardedInfiniteRequest)
// @ts-expect-error mutation results cannot be discarded
utils.users.get.mutationOptions({ rpcOptions: { discard: true } })
// @ts-expect-error stream adaptation owns queue conversion
utils.events.watch.streamedOptions({ input: { channel: 'news' }, rpcOptions: { asQueue: true } })
// @ts-expect-error live adaptation owns queue conversion even when skipped
utils.events.watch.liveOptions({ input: skipToken, rpcOptions: { asQueue: true } })
// @ts-expect-error request options are static, not variable callbacks
utils.users.get.mutationOptions({ rpcOptions: (_variables: { id: number }) => unaryRpcOptions })
// @ts-expect-error headers must use Effect's header input type
utils.health.ping.queryOptions({ rpcOptions: { headers: 42 } })
// @ts-expect-error context must be an Effect Context
utils.health.ping.mutationOptions({ rpcOptions: { context: {} } })
// @ts-expect-error stream buffer sizes are numeric
utils.events.audit.watch.liveOptions({ rpcOptions: { streamBufferSize: '8' } })
const discardOptions = { ...unaryRpcOptions, discard: true }
// @ts-expect-error variables cannot bypass the result control restriction
utils.users.get.mutationOptions({ rpcOptions: discardOptions })

// @ts-expect-error A caller hash cannot override generated RPC cache identity.
utils.users.get.queryOptions({ input: skipToken, queryHash: 'shared' })
