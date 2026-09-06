import type { DataTag, MutationObserverOptions } from '@tanstack/query-core'
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
  JsonValue,
  MutationOptions,
  OwnedMutationOption,
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
export type MethodEffect<Method> = Method extends (...args: never[]) => infer Result
  ? Result
  : never
export type ClientEffect<
  Group,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Client,
> = MethodEffect<Member<ClientGroup<Group, Client>, Endpoint['identifier']>>
export type MethodError<Method> =
  MethodEffect<Method> extends Effect.Effect<infer _A, infer Error, infer _R> ? Error : never
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
      }

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
      MethodError<Member<ClientGroup<Group, Client>, Endpoint['identifier']>>
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
    MethodError<Member<Client, Endpoint['identifier']>>
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
export type RetainedClientServices<Api extends HttpApi.Constraint, Client> = [
  ExposedEffects<Api, Client>,
] extends [never]
  ? never
  : ExposedEffects<Api, Client> extends Effect.Effect<infer _A, infer _E, infer Services>
    ? Services
    : never
export type ClientServices<Api extends HttpApi.Constraint, Client> =
  | HttpApiEndpoint.ClientServices<Supported<Endpoints<Groups<Api>>>>
  | HttpApiEndpoint.ErrorServicesDecode<Supported<Endpoints<Groups<Api>>>>
  | RetainedClientServices<Api, Client>
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
