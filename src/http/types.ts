import type {
  DataTag,
  InfiniteData,
  MutationObserverOptions,
  QueryFunction,
  SkipToken,
} from '@tanstack/query-core'
import type { Brand, Effect, Schema } from 'effect'
import type {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/unstable/httpapi'

import type {
  ContainsRedacted,
  InfiniteInput,
  InfiniteOptions,
  JsonValue,
  MutationOptions,
  OwnedMutationOption,
  OwnedQueryOption,
  QueryData,
  QueryInput,
  QueryOptions,
  RunPromiseExit,
  WithDefinedInitialData,
  WithUndefinedInitialData,
} from '../core/types'
import type { EffectHttpApiQueryError } from './errors'

export type Groups<Api extends HttpApi.Constraint> =
  Api extends HttpApi.HttpApi<infer _Id, infer Group> ? Group : never
export type ApiIdentifier<Api extends HttpApi.Constraint> =
  Api extends HttpApi.HttpApi<infer Id, infer _Group> ? Id : never
export type Endpoints<Group> = Extract<
  HttpApiGroup.Endpoints<Group>,
  HttpApiEndpoint.ConstraintRequest
>
export type ResponseBody<S> = S extends HttpApiSchema.WithHeaders<infer Body, Schema.Top> ? Body : S
export type MultipartPayload =
  | Brand.Brand<HttpApiSchema.MultipartTypeId>
  | Brand.Brand<HttpApiSchema.MultipartStreamTypeId>

/** Omits the complete endpoint when any declared alternative requires streaming or multipart. */
export type Supported<Endpoint> = Endpoint extends HttpApiEndpoint.ConstraintRequest
  ? [Extract<ResponseBody<Endpoint['~Success']>, HttpApiSchema.StreamSchema>] extends [never]
    ? [Extract<Endpoint['~Payload']['Type'], MultipartPayload>] extends [never]
      ? Endpoint
      : never
    : never
  : never

export type SupportedGroups<Api extends HttpApi.Constraint> =
  Groups<Api> extends infer Group
    ? Group extends HttpApiGroup.Constraint
      ? [Supported<Endpoints<Group>>] extends [never]
        ? never
        : Group
      : never
    : never

export type RequestFields<Endpoint extends HttpApiEndpoint.ConstraintRequest> = Omit<
  Exclude<
    HttpApiEndpoint.ClientRequest<
      Endpoint['~Params'],
      Endpoint['~Query'],
      Endpoint['~Payload'],
      Endpoint['~Headers'],
      'decoded-only'
    >,
    void
  >,
  'responseMode'
>

/** Uses decoded request fields while reserving response mode for the adapter. */
export type Request<Endpoint extends HttpApiEndpoint.ConstraintRequest> =
  keyof RequestFields<Endpoint> extends never
    ? void
    : RequestFields<Endpoint> & { readonly responseMode?: never }

export type Success<Endpoint extends HttpApiEndpoint.ConstraintRequest> =
  Endpoint['~Success']['Type']
export type Failure<ClientError> = EffectHttpApiQueryError<ClientError>
export type Member<Value, Key extends PropertyKey> = Key extends keyof Value ? Value[Key] : never
export type ClientGroup<Group, Client> = Group extends { readonly topLevel: true }
  ? Client
  : Group extends HttpApiGroup.Constraint
    ? Member<Client, Group['identifier']>
    : never
/** Exact identity keeps related response-only overloads from ending the traversal early. */
export type SeenMethod<Method, Seen extends readonly unknown[]> = Seen extends readonly [
  infer First,
  ...infer Rest,
]
  ? (<Value>() => Value extends Method ? 1 : 2) extends <Value>() => Value extends First ? 1 : 2
    ? true
    : SeenMethod<Method, Rest>
  : false
/** Rotates overloads into a union so response-only calls cannot replace decoded execution. */
export type MethodSignatures<
  Method,
  Partial = unknown,
  Seen extends readonly unknown[] = [],
> = Method extends (...args: infer Args) => infer Result
  ? SeenMethod<(...args: Args) => Result, Seen> extends true
    ? never
    :
        | ((...args: Args) => Result)
        | MethodSignatures<
            ((...args: Args) => Result) & Partial & Method,
            Partial & ((...args: Args) => Result),
            [...Seen, (...args: Args) => Result]
          >
  : never
export type DecodedEffect<
  Method,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
> = Method extends (
  request: RequestFields<Endpoint> & { readonly responseMode: 'decoded-only' },
) => infer Result
  ? Result
  : never
export type ClientEffect<
  Group,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Client,
> = DecodedEffect<
  MethodSignatures<Member<ClientGroup<Group, Client>, Endpoint['identifier']>>,
  Endpoint
>
export type ExposedEffects<Api extends HttpApi.Constraint, Client> =
  SupportedGroups<Api> extends infer Group
    ? Group extends HttpApiGroup.Constraint
      ? Supported<Endpoints<Group>> extends infer Endpoint
        ? Endpoint extends HttpApiEndpoint.ConstraintRequest
          ? ClientEffect<Group, Endpoint, Client>
          : never
        : never
      : never
    : never
export type Root<Api extends HttpApi.Constraint, Prefix extends readonly JsonValue[]> = readonly [
  ...Prefix,
  'http',
  ApiIdentifier<Api>,
]
export type EndpointKey<
  Api extends HttpApi.Constraint,
  Prefix extends readonly JsonValue[],
  Group extends HttpApiGroup.Constraint,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
> = Group extends { readonly topLevel: true }
  ? readonly [...Root<Api, Prefix>, Endpoint['identifier']]
  : readonly [...Root<Api, Prefix>, Group['identifier'], Endpoint['identifier']]
export type ConcreteKey<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = DataTag<
  void extends Request<Endpoint>
    ? readonly [...Key, 'query']
    : readonly [...Key, 'query', JsonValue],
  QueryData<Success<Endpoint>>,
  Failure<ClientError>
>
export type Input<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Selected,
> = QueryInput<
  QueryData<Success<Endpoint>>,
  Failure<ClientError>,
  Selected,
  ConcreteKey<Endpoint, Key, ClientError>
>
export type Options<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Selected,
> = QueryOptions<
  QueryData<Success<Endpoint>>,
  Failure<ClientError>,
  Selected,
  ConcreteKey<Endpoint, Key, ClientError>
>
export type DefinedInput<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Selected,
> = WithDefinedInitialData<
  Input<Endpoint, Key, ClientError, Selected>,
  QueryData<Success<Endpoint>>
>
export type UndefinedInput<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Selected,
> = WithUndefinedInitialData<
  Input<Endpoint, Key, ClientError, Selected>,
  QueryData<Success<Endpoint>>
>
export type DefinedOptions<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Selected,
> = WithDefinedInitialData<
  Options<Endpoint, Key, ClientError, Selected>,
  QueryData<Success<Endpoint>>
>

export type SkippedOptions<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Selected = QueryData<Success<Endpoint>>,
> = QueryOptions<
  QueryData<Success<Endpoint>>,
  Failure<ClientError>,
  Selected,
  readonly [...Key, 'query'],
  SkipToken
>

export type ConditionalKey<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = ConcreteKey<Endpoint, Key, ClientError> | readonly [...Key, 'query']

export type ConditionalOptions<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Selected,
> = QueryOptions<
  QueryData<Success<Endpoint>>,
  Failure<ClientError>,
  Selected,
  ConditionalKey<Endpoint, Key, ClientError>,
  | QueryFunction<QueryData<Success<Endpoint>>, ConditionalKey<Endpoint, Key, ClientError>>
  | SkipToken
>

export type QueryBuilder<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> =
  void extends Request<Endpoint>
    ? {
        <Selected = QueryData<Success<Endpoint>>>(
          options: DefinedInput<Endpoint, Key, ClientError, Selected>,
        ): DefinedOptions<Endpoint, Key, ClientError, Selected>
        <Selected = QueryData<Success<Endpoint>>>(
          options?: UndefinedInput<Endpoint, Key, ClientError, Selected>,
        ): Options<Endpoint, Key, ClientError, Selected>
      }
    : {
        <Selected = QueryData<Success<Endpoint>>>(
          options: DefinedInput<Endpoint, Key, ClientError, Selected> & {
            readonly input: Request<Endpoint>
          },
        ): DefinedOptions<Endpoint, Key, ClientError, Selected>
        <Selected = QueryData<Success<Endpoint>>>(
          options: UndefinedInput<Endpoint, Key, ClientError, Selected> & {
            readonly input: Request<Endpoint>
          },
        ): Options<Endpoint, Key, ClientError, Selected>
        <Selected = QueryData<Success<Endpoint>>>(
          options: WithDefinedInitialData<
            Omit<SkippedOptions<Endpoint, Key, ClientError, Selected>, OwnedQueryOption>,
            QueryData<Success<Endpoint>>
          > & { readonly input: SkipToken },
        ): WithDefinedInitialData<
          SkippedOptions<Endpoint, Key, ClientError, Selected>,
          QueryData<Success<Endpoint>>
        >
        <Selected = QueryData<Success<Endpoint>>>(
          options: Omit<SkippedOptions<Endpoint, Key, ClientError, Selected>, OwnedQueryOption> & {
            readonly input: SkipToken
          },
        ): SkippedOptions<Endpoint, Key, ClientError, Selected>
        <Selected = QueryData<Success<Endpoint>>>(
          options: WithDefinedInitialData<
            Omit<ConditionalOptions<Endpoint, Key, ClientError, Selected>, OwnedQueryOption>,
            QueryData<Success<Endpoint>>
          > & { readonly input: Request<Endpoint> | SkipToken },
        ): WithDefinedInitialData<
          ConditionalOptions<Endpoint, Key, ClientError, Selected>,
          QueryData<Success<Endpoint>>
        >
        <Selected = QueryData<Success<Endpoint>>>(
          options: Omit<
            ConditionalOptions<Endpoint, Key, ClientError, Selected>,
            OwnedQueryOption
          > & { readonly input: Request<Endpoint> | SkipToken },
        ): ConditionalOptions<Endpoint, Key, ClientError, Selected>
        (token: SkipToken): SkippedOptions<Endpoint, Key, ClientError>
      }

export type ConcreteInfiniteKey<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  PageParam = unknown,
> = DataTag<
  void extends Request<Endpoint>
    ? readonly [...Key, 'infinite']
    : readonly [...Key, 'infinite', JsonValue],
  InfiniteData<QueryData<Success<Endpoint>>, PageParam>,
  Failure<ClientError>
>

export type InfiniteQueryInput<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Selected,
  PageParam,
> = InfiniteInput<
  QueryData<Success<Endpoint>>,
  Failure<ClientError>,
  Selected,
  ConcreteInfiniteKey<Endpoint, Key, ClientError, PageParam>,
  PageParam
> &
  (void extends Request<Endpoint>
    ? unknown
    : { readonly input: (pageParam: PageParam) => Request<Endpoint> })

export type InfiniteQueryOptions<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Selected,
  PageParam,
> = InfiniteOptions<
  QueryData<Success<Endpoint>>,
  Failure<ClientError>,
  Selected,
  ConcreteInfiniteKey<Endpoint, Key, ClientError, PageParam>,
  PageParam
>

export type SkippedInfiniteOptions<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Selected,
  PageParam,
> = InfiniteOptions<
  QueryData<Success<Endpoint>>,
  Failure<ClientError>,
  Selected,
  readonly [...Key, 'infinite'],
  PageParam,
  SkipToken
>

export type ConditionalInfiniteKey<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  PageParam,
> = ConcreteInfiniteKey<Endpoint, Key, ClientError, PageParam> | readonly [...Key, 'infinite']

export type ConditionalInfiniteOptions<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Selected,
  PageParam,
> = InfiniteOptions<
  QueryData<Success<Endpoint>>,
  Failure<ClientError>,
  Selected,
  ConditionalInfiniteKey<Endpoint, Key, ClientError, PageParam>,
  PageParam,
  | QueryFunction<
      QueryData<Success<Endpoint>>,
      ConditionalInfiniteKey<Endpoint, Key, ClientError, PageParam>,
      PageParam
    >
  | SkipToken
>

export type InfiniteBuilder<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = {
  <PageParam, Selected = InfiniteData<QueryData<Success<Endpoint>>, PageParam>>(
    options: WithDefinedInitialData<
      InfiniteQueryInput<Endpoint, Key, ClientError, Selected, PageParam>,
      InfiniteData<QueryData<Success<Endpoint>>, PageParam>
    >,
  ): WithDefinedInitialData<
    InfiniteQueryOptions<Endpoint, Key, ClientError, Selected, PageParam>,
    InfiniteData<QueryData<Success<Endpoint>>, PageParam>
  >
  <PageParam, Selected = InfiniteData<QueryData<Success<Endpoint>>, PageParam>>(
    options: WithUndefinedInitialData<
      InfiniteQueryInput<Endpoint, Key, ClientError, Selected, PageParam>,
      InfiniteData<QueryData<Success<Endpoint>>, PageParam>
    >,
  ): InfiniteQueryOptions<Endpoint, Key, ClientError, Selected, PageParam>
} & (void extends Request<Endpoint>
  ? unknown
  : {
      <PageParam, Selected = InfiniteData<QueryData<Success<Endpoint>>, PageParam>>(
        options: WithDefinedInitialData<
          Omit<
            SkippedInfiniteOptions<Endpoint, Key, ClientError, Selected, PageParam>,
            OwnedQueryOption
          >,
          InfiniteData<QueryData<Success<Endpoint>>, PageParam>
        > & { readonly input: SkipToken },
      ): WithDefinedInitialData<
        SkippedInfiniteOptions<Endpoint, Key, ClientError, Selected, PageParam>,
        InfiniteData<QueryData<Success<Endpoint>>, PageParam>
      >
      <PageParam, Selected = InfiniteData<QueryData<Success<Endpoint>>, PageParam>>(
        options: Omit<
          SkippedInfiniteOptions<Endpoint, Key, ClientError, Selected, PageParam>,
          OwnedQueryOption
        > & { readonly input: SkipToken },
      ): SkippedInfiniteOptions<Endpoint, Key, ClientError, Selected, PageParam>
      <PageParam, Selected = InfiniteData<QueryData<Success<Endpoint>>, PageParam>>(
        options: WithDefinedInitialData<
          Omit<
            ConditionalInfiniteOptions<Endpoint, Key, ClientError, Selected, PageParam>,
            OwnedQueryOption
          >,
          InfiniteData<QueryData<Success<Endpoint>>, PageParam>
        > & { readonly input: ((pageParam: PageParam) => Request<Endpoint>) | SkipToken },
      ): WithDefinedInitialData<
        ConditionalInfiniteOptions<Endpoint, Key, ClientError, Selected, PageParam>,
        InfiniteData<QueryData<Success<Endpoint>>, PageParam>
      >
      <PageParam, Selected = InfiniteData<QueryData<Success<Endpoint>>, PageParam>>(
        options: Omit<
          ConditionalInfiniteOptions<Endpoint, Key, ClientError, Selected, PageParam>,
          OwnedQueryOption
        > & { readonly input: ((pageParam: PageParam) => Request<Endpoint>) | SkipToken },
      ): ConditionalInfiniteOptions<Endpoint, Key, ClientError, Selected, PageParam>
    })

export type Leaf<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = {
  readonly key: () => Key
  readonly queryKey: void extends Request<Endpoint>
    ? () => ConcreteKey<Endpoint, Key, ClientError>
    : (input: Request<Endpoint>) => ConcreteKey<Endpoint, Key, ClientError>
  readonly queryOptions: QueryBuilder<Endpoint, Key, ClientError>
  readonly infiniteKey: void extends Request<Endpoint>
    ? () => ConcreteInfiniteKey<Endpoint, Key, ClientError>
    : (input: Request<Endpoint>) => ConcreteInfiniteKey<Endpoint, Key, ClientError>
  readonly infiniteOptions: InfiniteBuilder<Endpoint, Key, ClientError>
  readonly mutationKey: () => readonly [...Key, 'mutation']
  readonly mutationOptions: <OnMutateResult = unknown>(
    options?: Omit<
      MutationObserverOptions<
        Success<Endpoint>,
        Failure<ClientError>,
        Request<Endpoint>,
        OnMutateResult
      >,
      OwnedMutationOption
    >,
  ) => MutationOptions<
    Success<Endpoint>,
    Failure<ClientError>,
    Request<Endpoint>,
    readonly [...Key, 'mutation'],
    OnMutateResult
  >
}

/** An eager utility tree mirroring the ready HTTP client's literal properties. */
export type HttpApiQueryUtils<
  Api extends HttpApi.Constraint,
  Prefix extends readonly [JsonValue, ...JsonValue[]],
  Client = HttpApiClient.ForApi<Api>,
> = {
  readonly key: () => Root<Api, Prefix>
} & {
  readonly [
    Group in Extract<SupportedGroups<Api>, { readonly topLevel: false }> as Group['identifier']
  ]: {
    readonly key: () => readonly [...Root<Api, Prefix>, Group['identifier']]
  } & {
    readonly [Endpoint in Supported<Endpoints<Group>> as Endpoint['identifier']]: Leaf<
      Endpoint,
      EndpointKey<Api, Prefix, Group, Endpoint>,
      Effect.Error<ClientEffect<Group, Endpoint, Client>>
    >
  }
} & {
  readonly [
    Endpoint in Supported<
      Endpoints<Extract<SupportedGroups<Api>, { readonly topLevel: true }>>
    > as Endpoint['identifier']
  ]: Leaf<
    Endpoint,
    readonly [...Root<Api, Prefix>, Endpoint['identifier']],
    Effect.Error<ClientEffect<{ readonly topLevel: true }, Endpoint, Client>>
  >
}

/** Projects a complete decoded HTTP request into safe, synchronous cache identity. */
export type HttpApiKeyEncoder<Endpoint extends HttpApiEndpoint.ConstraintRequest> = (
  input: Request<Endpoint>,
) => JsonValue

export type InputEndpoints<Group> =
  Supported<Endpoints<Group>> extends infer Endpoint
    ? Endpoint extends HttpApiEndpoint.ConstraintRequest
      ? void extends Request<Endpoint>
        ? never
        : Endpoint
      : never
    : never
export type EncodingServices<Endpoint extends HttpApiEndpoint.ConstraintRequest> =
  | Endpoint['~Params']['EncodingServices']
  | Endpoint['~Query']['EncodingServices']
  | Endpoint['~Payload']['EncodingServices']
  | Endpoint['~Headers']['EncodingServices']
export type IsUnion<Value, Whole = Value> = Value extends Whole
  ? [Whole] extends [Value]
    ? false
    : true
  : never
export type PayloadSchemas<S> = S extends { readonly schema: infer Inner extends Schema.Constraint }
  ? Inner
  : S
export type RequiredEncoders<Group> =
  InputEndpoints<Group> extends infer Endpoint
    ? Endpoint extends HttpApiEndpoint.ConstraintRequest
      ? [EncodingServices<Endpoint>] extends [never]
        ? true extends
            | ContainsRedacted<Request<Endpoint>>
            | IsUnion<PayloadSchemas<Endpoint['~Payload']>>
          ? Endpoint
          : never
        : Endpoint
      : never
    : never
export type GroupEncoders<Group> = {
  readonly [
    Endpoint in RequiredEncoders<Group> as Endpoint['identifier']
  ]: HttpApiKeyEncoder<Endpoint>
} & {
  readonly [
    Endpoint in Exclude<InputEndpoints<Group>, RequiredEncoders<Group>> as Endpoint['identifier']
  ]?: HttpApiKeyEncoder<Endpoint>
}
export type EncoderGroups<Api extends HttpApi.Constraint> =
  SupportedGroups<Api> extends infer Group
    ? Group extends HttpApiGroup.Constraint
      ? [InputEndpoints<Group>] extends [never]
        ? never
        : Group
      : never
    : never
export type RequiredEncoderGroups<Api extends HttpApi.Constraint> =
  EncoderGroups<Api> extends infer Group
    ? Group extends HttpApiGroup.Constraint
      ? [RequiredEncoders<Group>] extends [never]
        ? never
        : Group
      : never
    : never
export type Encoders<Api extends HttpApi.Constraint> = {
  readonly [Group in RequiredEncoderGroups<Api> as Group['identifier']]: GroupEncoders<Group>
} & {
  readonly [
    Group in Exclude<EncoderGroups<Api>, RequiredEncoderGroups<Api>> as Group['identifier']
  ]?: GroupEncoders<Group>
}
export type EncoderOption<Api extends HttpApi.Constraint> = [EncoderGroups<Api>] extends [never]
  ? { readonly keyEncoders?: never }
  : [RequiredEncoderGroups<Api>] extends [never]
    ? { readonly keyEncoders?: Encoders<Api> }
    : { readonly keyEncoders: Encoders<Api> }
export type ClientServices<Api extends HttpApi.Constraint, Client> =
  | HttpApiEndpoint.ClientServices<Supported<Endpoints<Groups<Api>>>>
  | HttpApiEndpoint.ErrorServicesDecode<Supported<Endpoints<Groups<Api>>>>
  | Effect.Services<ExposedEffects<Api, Client>>
export type RunnerOption<Api extends HttpApi.Constraint, Client> = [
  ClientServices<Api, Client>,
] extends [never]
  ? { readonly runPromiseExit?: RunPromiseExit }
  : { readonly runPromiseExit: RunPromiseExit<ClientServices<Api, Client>> }

/** Derives HTTP utilities while the caller retains client and runtime ownership. */
export type CreateHttpApiQueryUtilsOptions<
  Api extends HttpApi.Constraint,
  Prefix extends readonly [JsonValue, ...JsonValue[]],
  Client = HttpApiClient.ForApi<Api>,
> = {
  readonly client: Client & HttpApiClient.ForApi<Api, unknown, unknown>
  readonly keyPrefix: Prefix
} & EncoderOption<Api> &
  RunnerOption<Api, NoInfer<Client>>
