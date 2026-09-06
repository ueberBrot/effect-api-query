import { MutationObserver, QueryClient, QueryObserver, skipToken } from '@tanstack/query-core'
import { useQuery } from '@tanstack/react-query'
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
import type { HttpClientError } from 'effect/unstable/http'
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
    'key' | 'queryKey' | 'queryOptions' | 'mutationKey' | 'mutationOptions'
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
// @ts-expect-error HTTP skip builders belong to the later expansion.
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

const ServicefulString = Schema.String.pipe(
  Schema.middlewareEncoding<typeof Schema.String, EncodeRequest>((encoding) =>
    Effect.flatMap(EncodeRequest, () => encoding),
  ),
)
const ServiceParts = HttpApiEndpoint.get('serviceParts', '/service-parts/:value', {
  params: { value: ServicefulString },
  query: { value: ServicefulString },
  headers: { value: ServicefulString },
})
const servicePartsApi = HttpApi.make('service-parts').add(
  HttpApiGroup.make('parts').add(ServiceParts),
)
declare const servicePartsClient: HttpApiClient.ForApi<typeof servicePartsApi>
declare const encodingRunner: RunPromiseExit<EncodeRequest>
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
