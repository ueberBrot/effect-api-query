import {
  InfiniteQueryObserver,
  MutationObserver,
  QueryClient,
  QueryObserver,
  skipToken,
  type InfiniteData,
  type SkipToken,
} from '@tanstack/query-core'
import {
  useInfiniteQuery,
  useMutation,
  usePrefetchInfiniteQuery,
  usePrefetchQuery,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { Context, Effect, Schema } from 'effect'
import {
  createHttpApiQueryUtils,
  EffectHttpApiQueryError,
  type CreateHttpApiQueryUtilsOptions,
  type EffectHttpApiQueryConfigErrorCode,
  type EffectHttpApiQueryKeyErrorCode,
  type HttpApiKeyEncoder,
  type HttpApiQueryUtils,
  type RunPromiseExit,
} from 'effect-api-query'
import type { HttpClient, HttpClientError, HttpClientResponse } from 'effect/unstable/http'
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/unstable/httpapi'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value

const User = Schema.Struct({ id: Schema.Number, name: Schema.String })
const Get = HttpApiEndpoint.get('get.user', '/users/:id', {
  params: { id: Schema.Number },
  query: { locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))) },
  headers: { 'x-version': Schema.Literal('v1') },
  success: User,
  error: Schema.Literal('not-found'),
})
const Save = HttpApiEndpoint.post('save', '/users', { payload: User, success: User })
const Ping = HttpApiEndpoint.get('ping', '/ping')
const Stream = HttpApiEndpoint.get('stream', '/stream', {
  success: HttpApiSchema.StreamUint8Array(),
})
const WrappedStream = HttpApiEndpoint.get('wrapped', '/wrapped', {
  success: HttpApiSchema.WithHeaders(
    HttpApiSchema.StreamUint8Array(),
    Schema.Struct({ version: Schema.String }),
  ),
})
const MixedStream = HttpApiEndpoint.get('mixed', '/mixed', {
  success: [Schema.String, HttpApiSchema.StreamUint8Array()],
})
const Multipart = HttpApiEndpoint.post('upload', '/upload', {
  payload: Schema.Struct({ name: Schema.String }).pipe(HttpApiSchema.asMultipart()),
})
const MultipartStream = HttpApiEndpoint.post('uploadStream', '/upload-stream', {
  payload: Schema.Struct({ name: Schema.String }).pipe(HttpApiSchema.asMultipartStream()),
})
const MixedMultipart = HttpApiEndpoint.post('mixedUpload', '/mixed-upload', {
  payload: [
    Schema.Struct({ name: Schema.String }),
    Schema.Struct({ file: Schema.String }).pipe(HttpApiSchema.asMultipart()),
  ],
})
const WrappedBuffered = HttpApiEndpoint.get('wrappedBuffered', '/wrapped-buffered', {
  success: HttpApiSchema.WithHeaders(User, Schema.Struct({ version: Schema.String })),
})
const api = HttpApi.make('account.api').add(
  HttpApiGroup.make('user.accounts').add(
    Get,
    Save,
    Stream,
    WrappedStream,
    MixedStream,
    Multipart,
    MultipartStream,
    MixedMultipart,
    WrappedBuffered,
  ),
  HttpApiGroup.make('system', { topLevel: true }).add(Ping),
  HttpApiGroup.make('omitted').add(Stream),
)
declare const client: HttpApiClient.ForApi<typeof api>
const prefix = ['app'] as const
const configuration: CreateHttpApiQueryUtilsOptions<typeof api, typeof prefix> = {
  client,
  keyPrefix: prefix,
}
const utils = createHttpApiQueryUtils(api, configuration)
const annotated: HttpApiQueryUtils<typeof api, typeof prefix> = utils
void annotated
const input = {
  params: { id: 1 },
  query: { locale: 'en' },
  headers: { 'x-version': 'v1' as const },
}
const query = utils['user.accounts']['get.user'].queryOptions({ input })
const queryClient = new QueryClient()

const root: readonly ['app', 'http', 'account.api'] = utils.key()
const groupKey: readonly ['app', 'http', 'account.api', 'user.accounts'] =
  utils['user.accounts'].key()
const endpointKey: readonly ['app', 'http', 'account.api', 'user.accounts', 'get.user'] =
  utils['user.accounts']['get.user'].key()
const topLevelKey: readonly ['app', 'http', 'account.api', 'ping'] = utils.ping.key()
void [root, groupKey, endpointKey, topLevelKey]
true satisfies Assert<
  Equal<keyof (typeof utils)['user.accounts'], 'key' | 'get.user' | 'save' | 'wrappedBuffered'>
>
true satisfies Assert<
  Equal<
    keyof typeof utils.ping,
    | 'key'
    | 'queryKey'
    | 'queryOptions'
    | 'mutationKey'
    | 'mutationOptions'
    | 'infiniteKey'
    | 'infiniteOptions'
  >
>
// @ts-expect-error HTTP identifiers preserve literal dots.
utils.user.accounts
// @ts-expect-error Groups containing only omitted endpoints disappear.
utils.omitted
// @ts-expect-error Top-level groups expose endpoints at the root.
utils.system
// @ts-expect-error HTTP input containers remain required.
utils['user.accounts']['get.user'].queryOptions()
// @ts-expect-error Decoded request types do not materialize constructor defaults.
utils['user.accounts']['get.user'].queryOptions({ input: { ...input, query: {} } })
// @ts-expect-error Params use decoded numbers.
utils['user.accounts']['get.user'].queryKey({ ...input, params: { id: '1' } })
// @ts-expect-error Literal headers remain constrained.
utils['user.accounts']['get.user'].queryKey({ ...input, headers: { 'x-version': 'v2' } })
// @ts-expect-error Response modes remain owned by the adapter, including predeclared objects.
utils['user.accounts']['get.user'].queryKey({ ...input, responseMode: 'response-only' as const })
declare const genericMode: HttpApiClient.Client.ResponseMode
const genericRequest = { ...input, responseMode: genericMode }
// @ts-expect-error A generic response-mode union cannot enter generated query data.
utils['user.accounts']['get.user'].queryOptions({ input: genericRequest })
utils['user.accounts']['get.user'].queryOptions({ input: skipToken })
// @ts-expect-error HTTP requests do not accept RPC options.
utils.ping.queryOptions({ rpcOptions: {} })
// @ts-expect-error The package owns query functions.
utils.ping.queryOptions({ queryFn: async () => null })

const fetched: Promise<typeof User.Type> = queryClient.query(query)
const ensured: Promise<typeof User.Type> = queryClient.ensureQueryData(query)
const cached: typeof User.Type | undefined = queryClient.getQueryData(query.queryKey)
queryClient.setQueryData(query.queryKey, (previous) => {
  const typed: typeof User.Type | undefined = previous
  return typed
})
const stateError:
  | EffectHttpApiQueryError<'not-found' | HttpClientError.HttpClientError | Schema.SchemaError>
  | null
  | undefined = queryClient.getQueryState(query.queryKey)?.error
void [fetched, ensured, cached, stateError]
// @ts-expect-error DataTag rejects a wrong cache value.
queryClient.setQueryData(query.queryKey, 'wrong')
const selected = utils['user.accounts']['get.user'].queryOptions({
  input,
  select: (user) => user.name,
  initialData: { id: 1, name: 'Ada' },
})
const observer = new QueryObserver(queryClient, selected)
const selectedData: string | undefined = observer.getCurrentResult().data
const hook = useQuery(selected)
const definedData: string = hook.data
const rawSelectedCache: typeof User.Type | undefined = queryClient.getQueryData(selected.queryKey)
const noContent: Promise<null> = queryClient.query(utils.ping.queryOptions())
void [selectedData, definedData, rawSelectedCache, noContent]
const wrapped = queryClient.query(utils['user.accounts'].wrappedBuffered.queryOptions())
const wrappedValue: Promise<
  HttpApiSchema.withHeaders<typeof User.Type, { readonly version: string }>
> = wrapped
void wrappedValue
const mutation = utils['user.accounts'].save.mutationOptions({
  onMutate: (request) => request.payload.id,
})
const mutationObserver = new MutationObserver(queryClient, mutation)
const mutationData: Promise<typeof User.Type> = mutationObserver.mutate({
  payload: { id: 1, name: 'Ada' },
})
const noContentMutation: Promise<void> = utils.ping.mutationOptions().mutationFn()
void [mutationData, noContentMutation]
// @ts-expect-error Mutations require the complete request container.
mutationObserver.mutate({ id: 1, name: 'Ada' })

class EncodeRequest extends Context.Service<EncodeRequest, {}>()('EncodeRequest') {}
class DecodeSuccess extends Context.Service<DecodeSuccess, {}>()('DecodeSuccess') {}
class DecodeError extends Context.Service<DecodeError, {}>()('DecodeError') {}
class ExtraClientService extends Context.Service<ExtraClientService, {}>()('ExtraClientService') {}
const ServicefulPayload = User.pipe(
  Schema.middlewareEncoding<typeof User, EncodeRequest>((encoding) =>
    Effect.flatMap(EncodeRequest, () => encoding),
  ),
)
const ServicefulSuccess = User.pipe(
  Schema.middlewareDecoding<typeof User, DecodeSuccess>((decoding) =>
    Effect.flatMap(DecodeSuccess, () => decoding),
  ),
)
const ErrorSchema = Schema.Literal('service-error')
const ServicefulError = ErrorSchema.pipe(
  Schema.middlewareDecoding<typeof ErrorSchema, DecodeError>((decoding) =>
    Effect.flatMap(DecodeError, () => decoding),
  ),
)
const Serviceful = HttpApiEndpoint.post('serviceful', '/serviceful', {
  payload: ServicefulPayload,
  success: ServicefulSuccess,
  error: ServicefulError,
})
const serviceApi = HttpApi.make('services').add(HttpApiGroup.make('work').add(Serviceful))
declare const serviceClient: HttpApiClient.ForApi<
  typeof serviceApi,
  'extra-client-error',
  ExtraClientService
>
declare const runner: RunPromiseExit<
  EncodeRequest | DecodeSuccess | DecodeError | ExtraClientService
>
const encoder: HttpApiKeyEncoder<typeof Serviceful> = (request) => request.payload.id
// @ts-expect-error Execution services require an explicit runner.
createHttpApiQueryUtils(serviceApi, {
  client: serviceClient,
  keyPrefix: ['app'],
  keyEncoders: { work: { serviceful: encoder } },
})
// @ts-expect-error A runner does not provide synchronous cache identity.
createHttpApiQueryUtils(serviceApi, {
  client: serviceClient,
  keyPrefix: ['app'],
  runPromiseExit: runner,
})
const serviceUtils = createHttpApiQueryUtils(serviceApi, {
  client: serviceClient,
  keyPrefix: ['app'],
  runPromiseExit: runner,
  keyEncoders: { work: { serviceful: encoder } },
})
const serviceQuery = serviceUtils.work.serviceful.queryOptions({
  input: { payload: { id: 1, name: 'Ada' } },
})
const serviceError:
  | EffectHttpApiQueryError<
      'service-error' | 'extra-client-error' | HttpClientError.HttpClientError | Schema.SchemaError
    >
  | null
  | undefined = queryClient.getQueryState(serviceQuery.queryKey)?.error
void serviceError
const serviceState = queryClient.getQueryState(serviceQuery.queryKey)
true satisfies Assert<
  Equal<
    NonNullable<typeof serviceState>['error'],
    EffectHttpApiQueryError<
      'service-error' | 'extra-client-error' | HttpClientError.HttpClientError | Schema.SchemaError
    > | null
  >
>
type ServiceRequirements = NonNullable<
  CreateHttpApiQueryUtilsOptions<
    typeof serviceApi,
    readonly ['app'],
    typeof serviceClient
  >['runPromiseExit']
>
true satisfies Assert<Equal<ServiceRequirements, typeof runner>>

const extraApi = HttpApi.make('extra').add(
  HttpApiGroup.make('system', { topLevel: true }).add(Ping),
)
declare const extraClient: HttpApiClient.ForApi<typeof extraApi, 'extra-error', ExtraClientService>
declare const extraRunner: RunPromiseExit<ExtraClientService>
// @ts-expect-error Additional ready-client services alone still require a runner.
createHttpApiQueryUtils(extraApi, { client: extraClient, keyPrefix: ['app'] })
const extraUtils = createHttpApiQueryUtils(extraApi, {
  client: extraClient,
  keyPrefix: ['app'],
  runPromiseExit: extraRunner,
})
const extraError:
  | EffectHttpApiQueryError<'extra-error' | HttpClientError.HttpClientError | Schema.SchemaError>
  | null
  | undefined = queryClient.getQueryState(extraUtils.ping.queryKey())?.error
void extraError

const secret = HttpApiEndpoint.post('secret', '/secret', {
  payload: Schema.Struct({ token: Schema.Redacted(Schema.String) }),
})
const secretApi = HttpApi.make('secret').add(
  HttpApiGroup.make('private.group', { topLevel: true }).add(secret),
)
declare const secretClient: HttpApiClient.ForApi<typeof secretApi>
// @ts-expect-error Redacted request parts require an explicit safe encoder.
createHttpApiQueryUtils(secretApi, { client: secretClient, keyPrefix: ['app'] })
createHttpApiQueryUtils(secretApi, {
  client: secretClient,
  keyPrefix: ['app'],
  keyEncoders: { 'private.group': { secret: () => 'safe-partition' } },
})
createHttpApiQueryUtils(secretApi, {
  client: secretClient,
  keyPrefix: ['app'],
  // @ts-expect-error Encoder maps use declaration group names even for top-level groups.
  keyEncoders: { secret: () => 'safe' },
})
createHttpApiQueryUtils(api, {
  client,
  keyPrefix: prefix,
  // @ts-expect-error Inputless endpoints cannot have encoders.
  keyEncoders: { system: { ping: () => null } },
})
createHttpApiQueryUtils(api, {
  client,
  keyPrefix: prefix,
  // @ts-expect-error Omitted endpoints cannot have encoders.
  keyEncoders: { 'user.accounts': { upload: () => null } },
})

const omittedService = HttpApiEndpoint.get('omittedService', '/omitted-service', {
  query: ServicefulPayload,
  success: HttpApiSchema.StreamUint8Array(),
})
const omittedServiceApi = HttpApi.make('omitted-service').add(
  HttpApiGroup.make('system').add(Ping, omittedService),
)
declare const omittedServiceClient: HttpApiClient.ForApi<typeof omittedServiceApi>
createHttpApiQueryUtils(omittedServiceApi, {
  client: omittedServiceClient,
  keyPrefix: ['app'],
}).system.ping.queryOptions()

const emptyApi = HttpApi.make('empty').add(HttpApiGroup.make('streams').add(Stream))
declare const emptyClient: HttpApiClient.ForApi<typeof emptyApi>
const emptyUtils = createHttpApiQueryUtils(emptyApi, { client: emptyClient, keyPrefix: ['app'] })
true satisfies Assert<Equal<keyof typeof emptyUtils, 'key'>>

const Alternatives = HttpApiEndpoint.post('alternatives', '/alternatives', {
  payload: [Schema.Struct({ name: Schema.String }), Schema.Struct({ id: Schema.Number })],
})
const alternativesApi = HttpApi.make('alternatives').add(
  HttpApiGroup.make('requests').add(Alternatives),
)
declare const alternativesClient: HttpApiClient.ForApi<typeof alternativesApi>
// @ts-expect-error Multiple payload schemas require explicit identity.
createHttpApiQueryUtils(alternativesApi, { client: alternativesClient, keyPrefix: ['app'] })
createHttpApiQueryUtils(alternativesApi, {
  client: alternativesClient,
  keyPrefix: ['app'],
  keyEncoders: { requests: { alternatives: (request) => request.payload } },
})

class Auth extends HttpApiMiddleware.Service<Auth, { clientError: 'client-auth' }>()('Auth', {
  error: Schema.Literal('unauthorized'),
  requiredForClient: true,
}) {}
const authorizedApi = HttpApi.make('authorized').add(
  HttpApiGroup.make('account').add(Ping.middleware(Auth)),
)
declare const authorizedClient: HttpApiClient.ForApi<typeof authorizedApi>
const authorized = createHttpApiQueryUtils(authorizedApi, {
  client: authorizedClient,
  keyPrefix: ['app'],
})
const authorizedState = queryClient.getQueryState(authorized.account.ping.queryKey())
true satisfies Assert<
  Equal<
    NonNullable<typeof authorizedState>['error'],
    EffectHttpApiQueryError<
      'unauthorized' | 'client-auth' | HttpClientError.HttpClientError | Schema.SchemaError
    > | null
  >
>

const HeaderSchema = Schema.Struct({ version: Schema.String })
const ServicefulHeaders = HeaderSchema.pipe(
  Schema.middlewareDecoding<typeof HeaderSchema, DecodeSuccess>((decoding) =>
    Effect.flatMap(DecodeSuccess, () => decoding),
  ),
)
const headerApi = HttpApi.make('headers').add(
  HttpApiGroup.make('account').add(
    HttpApiEndpoint.get('read', '/header-read', {
      success: HttpApiSchema.WithHeaders(User, ServicefulHeaders),
    }),
  ),
)
declare const headerClient: HttpApiClient.ForApi<typeof headerApi>
// @ts-expect-error Buffered response headers retain their decoding services.
createHttpApiQueryUtils(headerApi, { client: headerClient, keyPrefix: ['app'] })
declare const headerRunner: RunPromiseExit<DecodeSuccess>
createHttpApiQueryUtils(headerApi, {
  client: headerClient,
  keyPrefix: ['app'],
  runPromiseExit: headerRunner,
})
const configCode: EffectHttpApiQueryConfigErrorCode = 'UnsupportedEndpointMetadata'
const keyCode: EffectHttpApiQueryKeyErrorCode = 'RequestEncodingFailed'
void [configCode, keyCode]

const RequestParts = HttpApiEndpoint.post('request.parts', '/parts/:id', {
  params: { id: Schema.FiniteFromString },
  query: { filter: Schema.optional(Schema.String) },
  headers: { 'x-locale': Schema.String },
  payload: Schema.Struct({ page: Schema.FiniteFromString }),
})
const SecretParts = HttpApiEndpoint.post('secrets', '/secrets/:id', {
  params: { id: Schema.Redacted(Schema.String) },
  query: { query: Schema.Redacted(Schema.String) },
  headers: { 'x-secret': Schema.Redacted(Schema.String) },
  payload: Schema.Struct({ token: Schema.Redacted(Schema.String) }),
})
const TextOrJson = HttpApiEndpoint.post('textOrJson', '/alternatives', {
  payload: [Schema.FiniteFromString.pipe(HttpApiSchema.asText()), Schema.String],
})
const keysApi = HttpApi.make('keys').add(
  HttpApiGroup.make('forms.v1', { topLevel: true }).add(
    RequestParts,
    SecretParts,
    TextOrJson,
    Ping,
    Multipart,
  ),
)
declare const keysClient: HttpApiClient.ForApi<typeof keysApi>
const keyOptions = {
  client: keysClient,
  keyPrefix: ['tenant', 'north', 'user', 'ada'] as const,
  keyEncoders: {
    'forms.v1': {
      secrets: (request) => {
        const typed: (typeof SecretParts)['~Params']['Type'] = request.params
        void typed
        return { secretId: 'public-id' }
      },
      textOrJson: ({ payload }) => ({
        format: typeof payload === 'number' ? 'text' : 'json',
        value: String(payload),
      }),
    },
  },
} satisfies CreateHttpApiQueryUtilsOptions<
  typeof keysApi,
  readonly ['tenant', 'north', 'user', 'ada']
>
const keyUtils = createHttpApiQueryUtils(keysApi, keyOptions)
const completeRequest = {
  params: { id: 1 },
  query: {},
  headers: { 'x-locale': 'en' },
  payload: { page: 2 },
}
keyUtils['request.parts'].queryKey(completeRequest)
keyUtils['request.parts'].mutationOptions().mutationFn(completeRequest)
// @ts-expect-error A declared optional-only query container stays required.
keyUtils['request.parts'].queryKey({
  params: { id: 1 },
  headers: { 'x-locale': 'en' },
  payload: { page: 2 },
})
// @ts-expect-error HTTP payloads use decoded fields.
keyUtils['request.parts'].queryKey({ ...completeRequest, payload: { page: '2' } })
// @ts-expect-error Mutations retain all request containers.
keyUtils['request.parts'].mutationOptions().mutationFn({ payload: { page: 2 } })
const rawMutationRequest = { ...completeRequest, responseMode: 'response-only' as const }
// @ts-expect-error Mutation variables reserve response controls, including predeclared objects.
keyUtils['request.parts'].mutationOptions().mutationFn(rawMutationRequest)
// @ts-expect-error Encoders use declaration groups even when endpoints project to the root.
createHttpApiQueryUtils(keysApi, { ...keyOptions, keyEncoders: { secrets: () => null } })
// @ts-expect-error Dotted identifiers are literal map keys.
createHttpApiQueryUtils(keysApi, { ...keyOptions, keyEncoders: { 'forms.v1.secrets': () => null } })
createHttpApiQueryUtils(keysApi, {
  ...keyOptions,
  // @ts-expect-error Inputless endpoints have no encoder entry.
  keyEncoders: { 'forms.v1': { ...keyOptions.keyEncoders['forms.v1'], ping: () => null } },
})
createHttpApiQueryUtils(keysApi, {
  ...keyOptions,
  // @ts-expect-error Omitted endpoints have no encoder entry.
  keyEncoders: { 'forms.v1': { ...keyOptions.keyEncoders['forms.v1'], upload: () => null } },
})
createHttpApiQueryUtils(keysApi, {
  ...keyOptions,
  // @ts-expect-error Redacted requests require an encoder independently of alternatives.
  keyEncoders: { 'forms.v1': { textOrJson: () => null } },
})
createHttpApiQueryUtils(keysApi, {
  ...keyOptions,
  // @ts-expect-error Distinct retained payload schemas require an encoder.
  keyEncoders: { 'forms.v1': { secrets: () => null } },
})

class EncodeParams extends Context.Service<EncodeParams, {}>()('EncodeParams') {}
class EncodeQuery extends Context.Service<EncodeQuery, {}>()('EncodeQuery') {}
class EncodeHeaders extends Context.Service<EncodeHeaders, {}>()('EncodeHeaders') {}
const ServicefulParams = Schema.String.pipe(
  Schema.middlewareEncoding<typeof Schema.String, EncodeParams>((encoding) =>
    Effect.flatMap(EncodeParams, () => encoding),
  ),
)
const ServicefulQuery = Schema.String.pipe(
  Schema.middlewareEncoding<typeof Schema.String, EncodeQuery>((encoding) =>
    Effect.flatMap(EncodeQuery, () => encoding),
  ),
)
const ServicefulRequestHeaders = Schema.String.pipe(
  Schema.middlewareEncoding<typeof Schema.String, EncodeHeaders>((encoding) =>
    Effect.flatMap(EncodeHeaders, () => encoding),
  ),
)
const ServiceParts = HttpApiEndpoint.get('serviceParts', '/service-parts/:value', {
  params: { value: ServicefulParams },
  query: { value: ServicefulQuery },
  headers: { value: ServicefulRequestHeaders },
})
const servicePartsApi = HttpApi.make('service-parts').add(
  HttpApiGroup.make('parts').add(ServiceParts),
)
declare const servicePartsClient: HttpApiClient.ForApi<typeof servicePartsApi>
declare const encodingRunner: RunPromiseExit<EncodeParams | EncodeQuery | EncodeHeaders>
type RequestPartRequirements = CreateHttpApiQueryUtilsOptions<
  typeof servicePartsApi,
  readonly ['app']
>['runPromiseExit']
true satisfies Assert<Equal<RequestPartRequirements, typeof encodingRunner>>
// @ts-expect-error Encoding services in non-payload request parts require a key encoder.
createHttpApiQueryUtils(servicePartsApi, {
  client: servicePartsClient,
  keyPrefix: ['app'],
  runPromiseExit: encodingRunner,
})
createHttpApiQueryUtils(servicePartsApi, {
  client: servicePartsClient,
  keyPrefix: ['app'],
  runPromiseExit: encodingRunner,
  keyEncoders: {
    parts: {
      serviceParts: (request) => ({
        params: request.params.value,
        query: request.query.value,
        headers: request.headers.value,
      }),
    },
  },
})

const bufferedApi = HttpApi.make('buffered').add(
  HttpApiGroup.make('responses').add(
    HttpApiEndpoint.get('text', '/text', {
      success: Schema.String.pipe(HttpApiSchema.asText()),
    }),
    HttpApiEndpoint.get('binary', '/binary', {
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    }),
    HttpApiEndpoint.get('decoded', '/decoded', { success: Schema.FiniteFromString }),
  ),
)
const constructed = Effect.gen(function* () {
  const ready = yield* HttpApiClient.make(bufferedApi)
  const generated = createHttpApiQueryUtils(bufferedApi, { client: ready, keyPrefix: ['app'] })
  const text = queryClient.query(generated.responses.text.queryOptions())
  const binary = queryClient.query(generated.responses.binary.queryOptions())
  const decoded = queryClient.query(generated.responses.decoded.queryOptions())
  true satisfies Assert<Equal<typeof text, Promise<string>>>
  true satisfies Assert<Equal<typeof binary, Promise<Uint8Array>>>
  true satisfies Assert<Equal<typeof decoded, Promise<number>>>
  const changed = generated.responses.binary.mutationOptions().mutationFn()
  true satisfies Assert<Equal<typeof changed, Promise<Uint8Array>>>
  return generated
})
true satisfies Assert<Equal<Effect.Services<typeof constructed>, HttpClient.HttpClient>>

declare const configuredTransport: HttpClient.HttpClient.With<
  HttpClientError.HttpClientError | 'configured-transport-error',
  ExtraClientService
>
const constructedWith = Effect.gen(function* () {
  const ready = yield* HttpApiClient.makeWith(authorizedApi, {
    httpClient: configuredTransport,
  })
  // @ts-expect-error Transport services remain required after client construction.
  createHttpApiQueryUtils(authorizedApi, { client: ready, keyPrefix: ['app'] })
  const generated = createHttpApiQueryUtils(authorizedApi, {
    client: ready,
    keyPrefix: ['app'],
    runPromiseExit: extraRunner,
  })
  const state = queryClient.getQueryState(generated.account.ping.queryKey())
  true satisfies Assert<
    Equal<
      NonNullable<typeof state>['error'],
      EffectHttpApiQueryError<
        | 'unauthorized'
        | 'client-auth'
        | 'configured-transport-error'
        | HttpClientError.HttpClientError
        | Schema.SchemaError
      > | null
    >
  >
  return generated
})
true satisfies Assert<
  Equal<Effect.Services<typeof constructedWith>, HttpApiMiddleware.ForClient<Auth>>
>

const customClient = {
  ...client,
  'user.accounts': {
    ...client['user.accounts'],
    save: <Mode extends HttpApiClient.Client.ResponseMode>(request: {
      readonly payload: typeof User.Type
      readonly responseMode?: Mode
    }) =>
      Effect.flatMap(ExtraClientService, () =>
        client['user.accounts']
          .save(request)
          .pipe(Effect.mapError(() => 'custom-save-error' as const)),
      ),
  },
}
// @ts-expect-error Compatible custom methods retain their residual services.
createHttpApiQueryUtils(api, { client: customClient, keyPrefix: ['app'] })
const custom = createHttpApiQueryUtils(api, {
  client: customClient,
  keyPrefix: ['app'],
  runPromiseExit: extraRunner,
})
const customState = queryClient.getQueryState(
  custom['user.accounts'].save.queryKey({ payload: { id: 1, name: 'Ada' } }),
)
true satisfies Assert<
  Equal<
    NonNullable<typeof customState>['error'],
    EffectHttpApiQueryError<'custom-save-error'> | null
  >
>
const customData = queryClient.query(
  custom['user.accounts'].save.queryOptions({ input: { payload: { id: 1, name: 'Ada' } } }),
)
true satisfies Assert<Equal<typeof customData, Promise<typeof User.Type>>>
createHttpApiQueryUtils(api, {
  client: customClient,
  keyPrefix: ['app'],
  // @ts-expect-error An unrelated schema runner cannot supply custom method services.
  runPromiseExit: headerRunner,
})
createHttpApiQueryUtils(serviceApi, {
  client: serviceClient,
  keyPrefix: ['app'],
  keyEncoders: { work: { serviceful: encoder } },
  // @ts-expect-error A custom key encoder leaves execution schema services intact.
  runPromiseExit: extraRunner,
})

const omittedCustomClient = {
  ...omittedServiceClient,
  system: {
    ...omittedServiceClient.system,
    omittedService: <Mode extends HttpApiClient.Client.ResponseMode>(request: {
      readonly query: typeof User.Type
      readonly responseMode?: Mode
    }) =>
      Effect.flatMap(ExtraClientService, () => omittedServiceClient.system.omittedService(request)),
  },
}
const omittedCustom = createHttpApiQueryUtils(omittedServiceApi, {
  client: omittedCustomClient,
  keyPrefix: ['app'],
})
true satisfies Assert<Equal<keyof typeof omittedCustom.system, 'key' | 'ping'>>

class DecodeMiddlewareError extends Context.Service<DecodeMiddlewareError, {}>()(
  'DecodeMiddlewareError',
) {}
const MiddlewareErrorSchema = Schema.Literal('serviceful-middleware-error')
class ServicefulAuth extends HttpApiMiddleware.Service<ServicefulAuth>()('ServicefulAuth', {
  error: MiddlewareErrorSchema.pipe(
    Schema.middlewareDecoding<typeof MiddlewareErrorSchema, DecodeMiddlewareError>((decoding) =>
      Effect.flatMap(DecodeMiddlewareError, () => decoding),
    ),
  ),
}) {}
const middlewareServiceApi = HttpApi.make('middleware-services').add(
  HttpApiGroup.make('account').add(Ping.middleware(ServicefulAuth)),
)
declare const middlewareServiceClient: HttpApiClient.ForApi<typeof middlewareServiceApi>
// @ts-expect-error Middleware error schemas retain their decoding services.
createHttpApiQueryUtils(middlewareServiceApi, {
  client: middlewareServiceClient,
  keyPrefix: ['app'],
})
declare const middlewareRunner: RunPromiseExit<DecodeMiddlewareError>
createHttpApiQueryUtils(middlewareServiceApi, {
  client: middlewareServiceClient,
  keyPrefix: ['app'],
  runPromiseExit: middlewareRunner,
})
type MiddlewareRequirements = CreateHttpApiQueryUtilsOptions<
  typeof middlewareServiceApi,
  readonly ['app']
>['runPromiseExit']
true satisfies Assert<Equal<MiddlewareRequirements, typeof middlewareRunner>>
const omittedMiddlewareApi = HttpApi.make('omitted-middleware').add(
  HttpApiGroup.make('account').add(Ping, Stream.middleware(ServicefulAuth)),
)
declare const omittedMiddlewareClient: HttpApiClient.ForApi<typeof omittedMiddlewareApi>
createHttpApiQueryUtils(omittedMiddlewareApi, {
  client: omittedMiddlewareClient,
  keyPrefix: ['app'],
})

class RawResponseService extends Context.Service<RawResponseService, {}>()('RawResponseService') {}
type RawResponseMethod = (request: {
  readonly responseMode: 'response-only'
}) => Effect.Effect<HttpClientResponse.HttpClientResponse, 'raw-response-error', RawResponseService>
type SpecificRawResponseMethod = (request: {
  readonly responseMode: 'response-only'
  readonly trace: string
}) => Effect.Effect<HttpClientResponse.HttpClientResponse, 'raw-response-error', RawResponseService>
type ResponseTupleMethod = (request: {
  readonly responseMode: 'decoded-and-response'
}) => Effect.Effect<
  readonly [typeof User.Type, HttpClientResponse.HttpClientResponse],
  'tuple-error',
  RawResponseService
>

declare const overloadedServiceMethod: typeof serviceClient.work.serviceful &
  ResponseTupleMethod &
  RawResponseMethod &
  SpecificRawResponseMethod
const overloadedServiceClient = { work: { serviceful: overloadedServiceMethod } }
// @ts-expect-error A trailing raw-response overload cannot hide decoded execution services.
createHttpApiQueryUtils(serviceApi, {
  client: overloadedServiceClient,
  keyPrefix: ['app'],
  keyEncoders: { work: { serviceful: encoder } },
})
const overloadedServiceUtils = createHttpApiQueryUtils(serviceApi, {
  client: overloadedServiceClient,
  keyPrefix: ['app'],
  keyEncoders: { work: { serviceful: encoder } },
  runPromiseExit: runner,
})
type OverloadedRequirements = CreateHttpApiQueryUtilsOptions<
  typeof serviceApi,
  readonly ['app'],
  typeof overloadedServiceClient
>['runPromiseExit']
true satisfies Assert<Equal<OverloadedRequirements, typeof runner>>
const overloadedServiceState = queryClient.getQueryState(
  overloadedServiceUtils.work.serviceful.queryKey({ payload: { id: 1, name: 'Ada' } }),
)
true satisfies Assert<
  Equal<
    NonNullable<typeof overloadedServiceState>['error'],
    NonNullable<typeof serviceState>['error']
  >
>
createHttpApiQueryUtils(serviceApi, {
  client: overloadedServiceClient,
  keyPrefix: ['app'],
  keyEncoders: { work: { serviceful: encoder } },
  // @ts-expect-error Decoded schema requirements survive response-control overloads.
  runPromiseExit: extraRunner,
})

declare const overloadedCustomMethod: (typeof customClient)['user.accounts']['save'] &
  RawResponseMethod
const overloadedCustomClient = {
  ...client,
  'user.accounts': { ...client['user.accounts'], save: overloadedCustomMethod },
}
const overloadedCustomUtils = createHttpApiQueryUtils(api, {
  client: overloadedCustomClient,
  keyPrefix: ['app'],
  runPromiseExit: extraRunner,
})
const overloadedCustomState = queryClient.getQueryState(
  overloadedCustomUtils['user.accounts'].save.queryKey({ payload: { id: 1, name: 'Ada' } }),
)
true satisfies Assert<
  Equal<
    NonNullable<typeof overloadedCustomState>['error'],
    EffectHttpApiQueryError<'custom-save-error'> | null
  >
>

declare const rawFirstMethod: RawResponseMethod & typeof client.ping
const rawFirst = createHttpApiQueryUtils(extraApi, {
  client: { ping: rawFirstMethod },
  keyPrefix: ['app'],
})
declare const rawLastMethod: typeof client.ping & RawResponseMethod
const rawLast = createHttpApiQueryUtils(extraApi, {
  client: { ping: rawLastMethod },
  keyPrefix: ['app'],
})
const rawFirstState = queryClient.getQueryState(rawFirst.ping.queryKey())
const rawLastState = queryClient.getQueryState(rawLast.ping.queryKey())
true satisfies Assert<
  Equal<NonNullable<typeof rawFirstState>['error'], NonNullable<typeof rawLastState>['error']>
>

const overloadedCustomMutation = new MutationObserver(
  queryClient,
  overloadedCustomUtils['user.accounts'].save.mutationOptions(),
).getCurrentResult()
true satisfies Assert<
  Equal<typeof overloadedCustomMutation.error, EffectHttpApiQueryError<'custom-save-error'> | null>
>

// HTTP option builders retain native inference for complete requests and buffered results.
type GetFailure = EffectHttpApiQueryError<
  'not-found' | HttpClientError.HttpClientError | Schema.SchemaError
>
const getUser = utils['user.accounts']['get.user']
const nativeQuery = getUser.queryOptions({
  input,
  select: (user) => user.name,
  retry: (_count, error) => {
    error satisfies GetFailure
    return false
  },
  staleTime: (query) => {
    query.state.data satisfies typeof User.Type | undefined
    query.queryKey satisfies ReturnType<typeof getUser.queryKey>
    return 1_000
  },
  refetchInterval: (query) => {
    query.state.error satisfies GetFailure | null
    return false
  },
  throwOnError: (error, query) => {
    error satisfies GetFailure
    query.state.data satisfies typeof User.Type | undefined
    return true
  },
})
useQuery(nativeQuery).data satisfies string | undefined
useSuspenseQuery(nativeQuery).data satisfies string
usePrefetchQuery(nativeQuery)
queryClient.prefetchQuery(query)
queryClient.invalidateQueries({ queryKey: query.queryKey })
queryClient.refetchQueries({ queryKey: getUser.key() })
// @ts-expect-error HTTP input is consumed before returning Query Core options.
nativeQuery.input
// @ts-expect-error Query keys belong to the package.
getUser.queryOptions({ input, queryKey: ['other'] })
// @ts-expect-error Query hashing belongs to the package.
getUser.queryOptions({ input, queryKeyHashFn: () => 'other' })
const optionalInitial = (): typeof User.Type | undefined => undefined
const maybeInitial = useQuery(
  getUser.queryOptions({ input, initialData: optionalInitial, select: (user) => user.name }),
)
true satisfies Assert<Equal<typeof maybeInitial.data, string | undefined>>
const definedInitial = useQuery(
  getUser.queryOptions({
    input,
    initialData: () => ({ id: 1, name: 'Ada' }),
    select: (user) => user.name,
  }),
)
true satisfies Assert<Equal<typeof definedInitial.data, string>>

const skippedDirect = getUser.queryOptions(skipToken)
skippedDirect.queryFn satisfies SkipToken
const skippedObject = getUser.queryOptions({
  input: skipToken,
  select: (user) => user.name,
  staleTime: (query) => {
    query.queryKey satisfies readonly [
      'app',
      'http',
      'account.api',
      'user.accounts',
      'get.user',
      'query',
    ]
    return 1_000
  },
  retry: (_count, error) => {
    error satisfies GetFailure
    return false
  },
})
skippedObject.queryFn satisfies SkipToken
useQuery(skippedObject).data satisfies string | undefined
new QueryObserver(queryClient, skippedObject).getCurrentResult().error satisfies GetFailure | null
// @ts-expect-error Suspense requires an executable query function.
useSuspenseQuery(skippedDirect)
// @ts-expect-error Prefetch-only hooks require an executable query function.
usePrefetchQuery(skippedObject)
const skippedDefined = useQuery(
  getUser.queryOptions({
    input: skipToken,
    initialData: { id: 1, name: 'Ada' },
    select: (user) => user.name,
  }),
)
true satisfies Assert<Equal<typeof skippedDefined.data, string | undefined>>
const skippedOptional = useQuery(
  getUser.queryOptions({ input: skipToken, initialData: optionalInitial }),
)
true satisfies Assert<Equal<typeof skippedOptional.data, typeof User.Type | undefined>>
declare const hasUser: boolean
const conditional = getUser.queryOptions({
  input: hasUser ? input : skipToken,
  select: (user) => user.name,
})
useQuery(conditional).data satisfies string | undefined
// @ts-expect-error A conditional request cannot guarantee suspense execution.
useSuspenseQuery(conditional)
// @ts-expect-error Key builders require concrete requests.
getUser.queryKey(skipToken)
// @ts-expect-error Infinite key builders require concrete requests.
getUser.infiniteKey(skipToken)
// @ts-expect-error Mutation builders reject the skip sentinel.
getUser.mutationOptions(skipToken)
// @ts-expect-error Mutation variables require concrete requests.
getUser.mutationOptions().mutationFn(skipToken)
// @ts-expect-error Inputless ordinary builders cannot be skipped.
utils.ping.queryOptions(skipToken)
// @ts-expect-error Inputless object builders cannot be skipped.
utils.ping.queryOptions({ input: skipToken })

const userPages = getUser.infiniteOptions({
  initialPageParam: 0,
  input: (page) => {
    page satisfies number
    return { ...input, params: { id: page } }
  },
  getNextPageParam: (page, pages, pageParam, pageParams) => {
    page satisfies typeof User.Type
    pages satisfies (typeof User.Type)[]
    pageParam satisfies number
    pageParams satisfies number[]
    return pageParam < 3 ? pageParam + 1 : undefined
  },
  getPreviousPageParam: (_first, _pages, firstParam) =>
    firstParam > 0 ? firstParam - 1 : undefined,
  retry: (_count, error) => {
    error satisfies GetFailure
    return false
  },
  select: (data) => {
    data.pageParams satisfies number[]
    return data.pages.map((user) => user.name)
  },
})
const infiniteHook = useInfiniteQuery(userPages)
true satisfies Assert<Equal<typeof infiniteHook.data, string[] | undefined>>
true satisfies Assert<Equal<typeof infiniteHook.error, GetFailure | null>>
useSuspenseInfiniteQuery(userPages).data satisfies string[]
new InfiniteQueryObserver(queryClient, userPages).getCurrentResult().data satisfies
  | string[]
  | undefined
const infiniteCache = queryClient.getQueryData(userPages.queryKey)
true satisfies Assert<
  Equal<typeof infiniteCache, InfiniteData<typeof User.Type, number> | undefined>
>
const infiniteKeyCache = queryClient.getQueryData(getUser.infiniteKey(input))
true satisfies Assert<
  Equal<typeof infiniteKeyCache, InfiniteData<typeof User.Type, unknown> | undefined>
>
queryClient.setQueryData(userPages.queryKey, (previous) => {
  previous satisfies InfiniteData<typeof User.Type, number> | undefined
  return previous
})
// @ts-expect-error Infinite cache entries contain pages and page parameters.
queryClient.setQueryData(userPages.queryKey, { id: 1, name: 'Ada' })
// @ts-expect-error Request mappers are consumed before returning Query Core options.
userPages.input
const fetchPages = getUser.infiniteOptions({
  initialPageParam: 0,
  input: (page) => ({ ...input, params: { id: page } }),
  getNextPageParam: (_page, _pages, cursor) => cursor + 1,
})
queryClient.fetchInfiniteQuery(fetchPages) satisfies Promise<InfiniteData<typeof User.Type, number>>
queryClient.ensureInfiniteQueryData(fetchPages) satisfies Promise<
  InfiniteData<typeof User.Type, number>
>
queryClient.prefetchInfiniteQuery(fetchPages)
usePrefetchInfiniteQuery(fetchPages)
const initialPages = { pages: [{ id: 1, name: 'Ada' }], pageParams: [0] }
const definedPages = useInfiniteQuery(
  getUser.infiniteOptions({
    initialPageParam: 0,
    input: (page) => ({ ...input, params: { id: page } }),
    getNextPageParam: () => undefined,
    initialData: () => initialPages,
    select: (data) => data.pages.length,
  }),
)
true satisfies Assert<Equal<typeof definedPages.data, number>>
const optionalPages = (): InfiniteData<typeof User.Type, number> | undefined => undefined
const undefinedPages = useInfiniteQuery(
  getUser.infiniteOptions({
    initialPageParam: 0,
    input: (page) => ({ ...input, params: { id: page } }),
    getNextPageParam: () => undefined,
    initialData: optionalPages,
    select: (data) => data.pages.length,
  }),
)
true satisfies Assert<Equal<typeof undefinedPages.data, number | undefined>>
const skippedPages = getUser.infiniteOptions({
  input: skipToken,
  initialPageParam: 0,
  getNextPageParam: (page, _pages, cursor) => {
    page satisfies typeof User.Type
    cursor satisfies number
    return cursor + 1
  },
  select: (data) => data.pages.map((user) => user.name),
})
skippedPages.queryFn satisfies SkipToken
skippedPages.queryKey satisfies readonly [
  'app',
  'http',
  'account.api',
  'user.accounts',
  'get.user',
  'infinite',
]
useInfiniteQuery(skippedPages).data satisfies string[] | undefined
// @ts-expect-error Infinite suspense requires an executable query function.
useSuspenseInfiniteQuery(skippedPages)
// @ts-expect-error Infinite prefetch-only hooks require an executable query function.
usePrefetchInfiniteQuery(skippedPages)
const skippedDefinedPages = useInfiniteQuery(
  getUser.infiniteOptions({
    input: skipToken,
    initialPageParam: 0,
    getNextPageParam: () => undefined,
    initialData: initialPages,
    select: (data) => data.pages.length,
  }),
)
true satisfies Assert<Equal<typeof skippedDefinedPages.data, number>>
// @ts-expect-error Infinite skipping requires object options with pagination fields.
getUser.infiniteOptions(skipToken)
getUser.infiniteOptions({
  initialPageParam: 0,
  getNextPageParam: () => undefined,
  // @ts-expect-error Infinite requests must include every decoded request field.
  input: (page: number) => ({ params: { id: page } }),
})
utils.ping.infiniteOptions({
  initialPageParam: 0,
  getNextPageParam: () => undefined,
  // @ts-expect-error Inputless infinite builders cannot be skipped.
  input: skipToken,
})
getUser.infiniteOptions({
  initialPageParam: 0,
  getNextPageParam: () => undefined,
  input: () => input,
  // @ts-expect-error Infinite query functions belong to the package.
  queryFn: async () => ({ id: 1, name: 'Ada' }),
})
const inputlessPages = utils.ping.infiniteOptions({
  initialPageParam: 0,
  getNextPageParam: () => undefined,
})
useInfiniteQuery(inputlessPages).data satisfies InfiniteData<null, number> | undefined

const callbackMutation = getUser.mutationOptions({
  onMutate: (request) => ({ previousId: request.params.id }),
  onSuccess: (user, request, result) => {
    user satisfies typeof User.Type
    request satisfies typeof input
    result.previousId satisfies number
  },
  onError: (error, request, result) => {
    error satisfies GetFailure
    request satisfies typeof input
    result?.previousId satisfies number | undefined
  },
  onSettled: (user, error, request, result) => {
    user satisfies typeof User.Type | undefined
    error satisfies GetFailure | null
    request satisfies typeof input
    result?.previousId satisfies number | undefined
  },
})
new MutationObserver(queryClient, callbackMutation).mutate(input) satisfies Promise<
  typeof User.Type
>
const mutationHook = useMutation(callbackMutation)
true satisfies Assert<Equal<typeof mutationHook.data, typeof User.Type | undefined>>
true satisfies Assert<Equal<typeof mutationHook.error, GetFailure | null>>
mutationHook.variables satisfies typeof input | undefined
mutationHook.mutateAsync(input, {
  onSuccess: (user, request, result) => {
    user satisfies typeof User.Type
    request satisfies typeof input
    result?.previousId satisfies number | undefined
  },
  onError: (error, request, result) => {
    error satisfies GetFailure
    request satisfies typeof input
    result?.previousId satisfies number | undefined
  },
}) satisfies Promise<typeof User.Type>
// @ts-expect-error React mutations preserve complete HTTP request containers.
mutationHook.mutate({ params: { id: 1 } })
// @ts-expect-error Mutation keys belong to the package.
getUser.mutationOptions({ mutationKey: ['other'] })
// @ts-expect-error Mutation functions belong to the package.
getUser.mutationOptions({ mutationFn: async () => ({ id: 1, name: 'Ada' }) })
const servicePages = serviceUtils.work.serviceful.infiniteOptions({
  initialPageParam: 0,
  input: (id) => ({ payload: { id, name: 'Ada' } }),
  getNextPageParam: () => undefined,
})
const servicePagesState = queryClient.getQueryState(servicePages.queryKey)
true satisfies Assert<
  Equal<NonNullable<typeof servicePagesState>['error'], NonNullable<typeof serviceState>['error']>
>
const overloadedPages = overloadedCustomUtils['user.accounts'].save.infiniteOptions({
  initialPageParam: 0,
  input: (id) => ({ payload: { id, name: 'Ada' } }),
  getNextPageParam: () => undefined,
})
const overloadedPagesResult = useInfiniteQuery(overloadedPages)
true satisfies Assert<
  Equal<typeof overloadedPagesResult.error, EffectHttpApiQueryError<'custom-save-error'> | null>
>

const conditionalPages = getUser.infiniteOptions({
  initialPageParam: 0,
  input: hasUser ? (page) => ({ ...input, params: { id: page } }) : skipToken,
  getNextPageParam: (_page, _pages, cursor) => cursor + 1,
  select: (data) => data.pages.length,
})
const conditionalPagesHook = useInfiniteQuery(conditionalPages)
true satisfies Assert<Equal<typeof conditionalPagesHook.data, number | undefined>>
// @ts-expect-error Conditional infinite requests cannot guarantee suspense execution.
useSuspenseInfiniteQuery(conditionalPages)
const pageApi = HttpApi.make('pages').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('list', '/users', {
      query: { cursor: Schema.FiniteFromString, filter: Schema.String },
      success: Schema.Struct({
        items: Schema.Array(User),
        nextCursor: Schema.NullOr(Schema.Finite),
      }),
    }),
  ),
)
declare const pageClient: HttpApiClient.ForApi<typeof pageApi>
const pageUtils = createHttpApiQueryUtils(pageApi, { client: pageClient, keyPrefix: ['app'] })
const filter = 'active'
const documentedPages = pageUtils.users.list.infiniteOptions({
  initialPageParam: 0,
  input: (cursor) => ({ query: { cursor, filter } }),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
  select: (data) => data.pages.flatMap((page) => page.items),
})
const documentedResult = useInfiniteQuery(documentedPages)
true satisfies Assert<Equal<typeof documentedResult.data, (typeof User.Type)[] | undefined>>

// @ts-expect-error A caller hash cannot override generated HTTP cache identity.
getUser.queryOptions({ input, queryHash: 'shared' })
// @ts-expect-error Skipped options reserve the operation-level cache identity.
getUser.queryOptions({ input: skipToken, queryHash: 'shared' })
getUser.infiniteOptions({
  initialPageParam: 0,
  input: () => input,
  getNextPageParam: () => undefined,
  // @ts-expect-error A caller hash cannot merge ordinary and infinite caches.
  queryHash: 'shared',
})
