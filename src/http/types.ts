import type { DataTag } from "@tanstack/query-core";
import type { Brand, Effect, Schema, Stream, Types } from "effect";
import type { Sse } from "effect/encoding";
import type { HttpClientError } from "effect/http";
import type {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";

import type { PreparedInput } from "../core/prepared-input";
import type {
  BranchQueryFilter,
  LeafQueryFilter,
  StreamedFilterPolicy,
} from "../core/query-filter";
import type {
  ContainsRedacted,
  DirectArgs,
  DirectCall,
  InfiniteQueryBuilder,
  InfiniteQueryKey,
  UnaryQueryBuilder,
  JsonValue,
  KeyBuilder,
  KeyEncoderRequirement,
  MutationBuilder,
  OptionalKeyPrefix,
  QueryData,
  RequiredAdapterKeys,
  RunnerRequirement,
  StreamedPolicyOptions,
  LivePolicyOptions,
  utilityPaths,
} from "../core/types";
import type { UtilityOperationKey, UtilityRootKey } from "../core/utility-key";
import type {
  EffectHttpApiQueryConfigError,
  EffectHttpApiQueryEmptyStreamError,
  EffectHttpApiQueryError,
} from "./errors";

export type Groups<Api extends HttpApi.Constraint> =
  Api extends HttpApi.HttpApi<infer _Id, infer Group> ? Group : never;
export type ApiIdentifier<Api extends HttpApi.Constraint> =
  Api extends HttpApi.HttpApi<infer Id, infer _Group> ? Id : never;
export type Endpoints<Group> = Extract<
  HttpApiGroup.Endpoints<Group>,
  HttpApiEndpoint.ConstraintRequest
>;
export type SuccessSchema<Endpoint extends HttpApiEndpoint.ConstraintRequest> =
  [Endpoint["~Success"]] extends [never]
    ? typeof HttpApiSchema.NoContent
    : Endpoint["~Success"];
export type ResponseBody<S> =
  S extends HttpApiSchema.WithHeaders<infer Body, Schema.Top> ? Body : S;
export type MultipartPayload =
  | Brand.Brand<HttpApiSchema.MultipartTypeId>
  | Brand.Brand<HttpApiSchema.MultipartStreamTypeId>;

export type SseEndpoint<Endpoint> =
  Endpoint extends HttpApiEndpoint.ConstraintRequest
    ? [ResponseBody<SuccessSchema<Endpoint>>] extends [
        { readonly _tag: "StreamSse" },
      ]
      ? Endpoint
      : never
    : never;

export type StreamingEndpoint<Endpoint> =
  Endpoint extends HttpApiEndpoint.ConstraintRequest
    ? [ResponseBody<SuccessSchema<Endpoint>>] extends [
        { readonly _tag: "StreamSse" | "StreamNdjson" },
      ]
      ? true extends IsUnion<SuccessSchema<Endpoint>>
        ? never
        : Endpoint
      : never
    : never;

export type Supported<Endpoint> =
  Endpoint extends HttpApiEndpoint.ConstraintRequest
    ? [
        | Extract<Endpoint["~Payload"], HttpApiSchema.StreamSchema>
        | Extract<
            Endpoint["~Payload"]["Type"],
            Brand.Brand<HttpApiSchema.MultipartStreamTypeId>
          >
        | Extract<ResponseBody<SuccessSchema<Endpoint>>, HttpApiSchema.Upgrade>,
      ] extends [never]
      ? [
          Extract<
            ResponseBody<SuccessSchema<Endpoint>>,
            HttpApiSchema.StreamSchema
          >,
        ] extends [never]
        ? Endpoint
        : [StreamingEndpoint<Endpoint>] extends [never]
          ? never
          : [Extract<Endpoint["~Payload"]["Type"], MultipartPayload>] extends [
                never,
              ]
            ? Endpoint
            : never
      : never
    : never;

export type Queryable<Endpoint> =
  Endpoint extends HttpApiEndpoint.ConstraintRequest
    ? [Extract<Endpoint["~Payload"]["Type"], MultipartPayload>] extends [never]
      ? Endpoint
      : never
    : never;

export type SupportedGroups<Api extends HttpApi.Constraint> =
  Groups<Api> extends infer Group
    ? Group extends HttpApiGroup.Constraint
      ? [Supported<Endpoints<Group>>] extends [never]
        ? never
        : Group
      : never
    : never;

export type HasRequest<Endpoint extends HttpApiEndpoint.ConstraintRequest> = [
  | Endpoint["~Params"]["Type"]
  | Endpoint["~Query"]["Type"]
  | Endpoint["~Payload"]["Type"]
  | Endpoint["~Headers"]["Type"],
] extends [never]
  ? false
  : true;

export type RequestFields<Endpoint extends HttpApiEndpoint.ConstraintRequest> =
  Omit<
    Exclude<
      HttpApiEndpoint.ClientRequest<
        Endpoint["~Params"],
        Endpoint["~Query"],
        Endpoint["~Payload"],
        Endpoint["~Headers"],
        "decoded-only"
      >,
      void
    >,
    "responseMode" | "sseOptions"
  >;

export type Request<Endpoint extends HttpApiEndpoint.ConstraintRequest> =
  HasRequest<Endpoint> extends false
    ? void
    : RequestFields<Endpoint> & {
        readonly responseMode?: never;
        readonly sseOptions?: never;
      };

export type Success<Endpoint extends HttpApiEndpoint.ConstraintRequest> =
  HttpApiClient.SuccessType<SuccessSchema<Endpoint>>;
export type Failure<ClientError> = EffectHttpApiQueryError<ClientError>;
export type Member<Value, Key extends PropertyKey> = Key extends keyof Value
  ? Value[Key]
  : never;
export type ClientGroup<Group, Client> = Group extends {
  readonly topLevel: true;
}
  ? Client
  : Group extends HttpApiGroup.Constraint
    ? Member<Client, Group["identifier"]>
    : never;

export type SeenMethod<
  Method,
  Seen extends readonly unknown[],
> = Seen extends readonly [infer First, ...infer Rest]
  ? (<Value>() => Value extends Method ? 1 : 2) extends <
      Value,
    >() => Value extends First ? 1 : 2
    ? true
    : SeenMethod<Method, Rest>
  : false;

export type MethodSignatures<
  Method,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Partial = unknown,
  Seen extends readonly unknown[] = [],
> = Method extends (...args: infer Args) => infer Result
  ? SeenMethod<(...args: Args) => Result, Seen> extends true
    ? never
    :
        | ((...args: Args) => MethodResult<Method, Endpoint, Result>)
        | MethodSignatures<
            ((...args: Args) => Result) & Partial & Method,
            Endpoint,
            Partial & ((...args: Args) => Result),
            [...Seen, (...args: Args) => Result]
          >
  : never;
export type MethodResult<
  Method,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Result,
> =
  Result extends Effect.Effect<infer Data, infer Error, infer Services>
    ? unknown extends Services
      ? Method extends HttpApiClient.Client.Method<
          Endpoint,
          infer _Error,
          infer ResidualServices
        >
        ? Effect.Effect<
            Data,
            Error,
            ResidualServices | HttpApiEndpoint.ClientServices<Endpoint>
          >
        : Result
      : Result
    : Result;
export type HttpSseDecoderOptions = Sse.DecodeOptions & {
  readonly maxEventSize: number;
  readonly dispatchEmptyNamedEvents: boolean;
};

export type DecodedRequest<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Mode extends "decoded-only" | "decoded-and-response",
> = RequestFields<Endpoint> & { readonly responseMode: Mode } & ([
    SseEndpoint<Endpoint>,
  ] extends [never]
    ? unknown
    : { readonly sseOptions: HttpSseDecoderOptions });

export type HasMetadataView<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
> = [StreamingEndpoint<Endpoint>] extends [never]
  ? [Queryable<Endpoint>] extends [never]
    ? false
    : true
  : false;

export type DecodedEffect<
  Method,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Mode extends "decoded-only" | "decoded-and-response" = "decoded-only",
> = Method extends (request: DecodedRequest<Endpoint, Mode>) => infer Result
  ? Result
  : NarrowedDecodedEffect<Method, DecodedRequest<Endpoint, Mode>, Mode>;

export type NarrowedDecodedEffect<Method, Dispatched, Mode> = Method extends (
  request: infer Accepted
) => infer Result
  ? Accepted extends object
    ? [Exclude<RequiredAdapterKeys<Accepted>, keyof Dispatched>] extends [never]
      ? Mode extends (
          "responseMode" extends keyof Accepted
            ? Accepted["responseMode"]
            : unknown
        )
        ? Pick<
            Accepted,
            Exclude<keyof Accepted, "responseMode"> & keyof Dispatched
          > extends Partial<Dispatched>
          ? Result
          : never
        : never
      : never
    : never
  : never;
export type StandardEndpointError<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  E,
> =
  | HttpApiMiddleware.Error<Endpoint["~Middleware"]>
  | HttpApiMiddleware.ClientError<Endpoint["~Middleware"]>
  | E
  | HttpClientError.HttpClientError
  | Endpoint["~Error"]["Type"]
  | Schema.SchemaError;

export type StandardEndpointServices<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  R,
> = R | HttpApiEndpoint.ClientServices<Endpoint>;

export type StandardMethodParts<
  Method,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
> =
  Method extends HttpApiClient.Client.Method<Endpoint, infer E, infer R>
    ? Types.Equals<
        Method,
        HttpApiClient.Client.Method<Endpoint, E, R>
      > extends true
      ? readonly [E, R]
      : false
    : false;

export type StandardGroupParts<
  Group extends HttpApiGroup.Constraint,
  GroupClient,
> =
  GroupClient extends HttpApiClient.Client.Group<Group, infer E, infer R>
    ? Types.Equals<
        GroupClient,
        HttpApiClient.Client.Group<Group, E, R>
      > extends true
      ? readonly [E, R]
      : false
    : false;

export type StandardMethodEffect<
  Method,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
> =
  StandardMethodParts<Method, Endpoint> extends readonly [infer _E, infer _R]
    ? MethodResult<
        Method,
        Endpoint,
        Method extends (...args: never) => infer Result ? Result : never
      >
    : never;

export type AdditionalMethodSignatures<
  Method,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
> =
  Method extends HttpApiClient.Client.Method<Endpoint, infer E, infer R>
    ? Method extends HttpApiClient.Client.Method<Endpoint, E, R> &
        (infer Additional)
      ? Types.Equals<Additional, Method> extends true
        ? never
        : MethodSignatures<Additional, Endpoint>
      : never
    : never;
export type ResolveMethodEffects<
  Method,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
> =
  StandardMethodEffect<Method, Endpoint> extends infer Fast
    ? [Fast] extends [never]
      ?
          | MethodSignatures<Method, Endpoint>
          | AdditionalMethodSignatures<
              Method,
              Endpoint
            > extends infer Signatures
        ? readonly [
            DecodedEffect<Signatures, Endpoint>,
            HasMetadataView<Endpoint> extends true
              ? DecodedEffect<Signatures, Endpoint, "decoded-and-response">
              : never,
          ]
        : never
      : readonly [Fast, HasMetadataView<Endpoint> extends true ? Fast : never]
    : never;

export type MethodServices<
  Method,
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
> =
  StandardMethodParts<Method, Endpoint> extends readonly [infer _E, infer R]
    ? R
    : ExecutionServices<ResolveMethodEffects<Method, Endpoint>[number]>;
export type ExposedClientServices<Api extends HttpApi.Constraint, Client> =
  SupportedGroups<Api> extends infer Group
    ? Group extends HttpApiGroup.Constraint
      ? ClientGroup<Group, Client> extends infer GroupClient
        ? StandardGroupParts<Group, GroupClient> extends readonly [
            infer _E,
            infer R,
          ]
          ? R
          : Supported<Endpoints<Group>> extends infer Endpoint
            ? Endpoint extends HttpApiEndpoint.ConstraintRequest
              ? MethodServices<
                  Member<GroupClient, Endpoint["identifier"]>,
                  Endpoint
                >
              : never
            : never
        : never
      : never
    : never;
export type Root<
  Api extends HttpApi.Constraint,
  Prefix extends readonly JsonValue[],
> = UtilityRootKey<Prefix, readonly ["http", ApiIdentifier<Api>]>;
export type ConcreteKey<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = DataTag<
  HasRequest<Endpoint> extends false
    ? readonly [...Key, "query"]
    : readonly [...Key, "query", unknown],
  QueryData<Success<Endpoint>>,
  Failure<ClientError>
>;
export type QueryBuilder<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = UnaryQueryBuilder<
  Request<Endpoint>,
  QueryData<Success<Endpoint>>,
  Failure<ClientError>,
  ConcreteKey<Endpoint, Key, ClientError>,
  readonly [...Key, "query"],
  unknown,
  HasRequest<Endpoint> extends false ? true : false
>;

export type MetadataData<Endpoint extends HttpApiEndpoint.ConstraintRequest> = {
  readonly data: QueryData<Success<Endpoint>>;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
};

export type ConcreteMetadataKey<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = DataTag<
  HasRequest<Endpoint> extends false
    ? readonly [...Key, "metadata"]
    : readonly [...Key, "metadata", unknown],
  MetadataData<Endpoint>,
  Failure<ClientError>
>;

export type MetadataBuilder<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = UnaryQueryBuilder<
  Request<Endpoint>,
  MetadataData<Endpoint>,
  Failure<ClientError>,
  ConcreteMetadataKey<Endpoint, Key, ClientError>,
  readonly [...Key, "metadata"],
  unknown,
  HasRequest<Endpoint> extends false ? true : false
>;

export type ConcreteInfiniteKey<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  PageParam = unknown,
> = InfiniteQueryKey<
  Request<Endpoint>,
  QueryData<Success<Endpoint>>,
  Failure<ClientError>,
  readonly [...Key, "infinite"],
  PageParam,
  HasRequest<Endpoint> extends false ? true : false
>;

export type InfiniteBuilder<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = InfiniteQueryBuilder<
  Request<Endpoint>,
  QueryData<Success<Endpoint>>,
  Failure<ClientError>,
  readonly [...Key, "infinite"],
  unknown,
  HasRequest<Endpoint> extends false ? true : false
>;

export type DirectRequest<Endpoint extends HttpApiEndpoint.ConstraintRequest> =
  [Queryable<Endpoint>] extends [never]
    ? Request<Endpoint>
    : Request<Endpoint> | PreparedInput<Request<Endpoint>>;

export type MutationLeaf<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  Services,
> = {
  /** Runs the endpoint through the leaf's runtime and returns decoded success. */
  readonly call: DirectCall<
    DirectRequest<Endpoint>,
    HasRequest<Endpoint> extends false ? true : false,
    Success<Endpoint>
  >;

  /** Returns the decoded-only client Effect with its original errors and services. */
  readonly effect: (
    ...args: DirectArgs<
      DirectRequest<Endpoint>,
      HasRequest<Endpoint> extends false ? true : false
    >
  ) => Effect.Effect<Success<Endpoint>, ClientError, Services>;

  readonly key: () => Key;
  readonly mutationKey: () => readonly [...Key, "mutation"];
  readonly mutationOptions: MutationBuilder<
    Success<Endpoint>,
    Failure<ClientError>,
    Request<Endpoint>,
    readonly [...Key, "mutation"]
  >;
};

export type BufferedLeaf<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
  MetadataClientError,
  Services,
> = MutationLeaf<Endpoint, Key, ClientError, Services> &
  ([Queryable<Endpoint>] extends [never]
    ? unknown
    : {
        /** Builds native filters for this buffered HTTP endpoint. */
        readonly queryFilter: LeafQueryFilter<
          Request<Endpoint>,
          HasRequest<Endpoint> extends false ? true : false,
          "query" | "infinite" | "metadata"
        >;
        readonly queryKey: KeyBuilder<
          Request<Endpoint>,
          ConcreteKey<Endpoint, Key, ClientError>,
          HasRequest<Endpoint> extends false ? true : false
        >;
        readonly queryOptions: QueryBuilder<Endpoint, Key, ClientError>;
        readonly metadataKey: KeyBuilder<
          Request<Endpoint>,
          ConcreteMetadataKey<Endpoint, Key, MetadataClientError>,
          HasRequest<Endpoint> extends false ? true : false
        >;
        readonly metadataOptions: MetadataBuilder<
          Endpoint,
          Key,
          MetadataClientError
        >;
        readonly infiniteKey: KeyBuilder<
          Request<Endpoint>,
          ConcreteInfiniteKey<Endpoint, Key, ClientError>,
          HasRequest<Endpoint> extends false ? true : false
        >;
        readonly infiniteOptions: InfiniteBuilder<Endpoint, Key, ClientError>;
      });

export type StreamChunk<Value> =
  Value extends HttpApiSchema.withHeaders<infer Body, infer Headers>
    ? Body extends Stream.Stream<infer Chunk, infer _Error, infer _Services>
      ? HttpApiSchema.withHeaders<Chunk, Headers>
      : never
    : Value extends Stream.Stream<infer Chunk, infer _Error, infer _Services>
      ? Chunk
      : never;

export type StreamFailure<Value> =
  Value extends HttpApiSchema.withHeaders<infer Body, infer _Headers>
    ? StreamFailure<Body>
    : Value extends Stream.Stream<infer _Chunk, infer Error, infer _Services>
      ? Error
      : never;

export type HttpDecoderPolicy<Endpoint> = [SseEndpoint<Endpoint>] extends [
  never,
]
  ? { readonly sseOptions?: never }
  : { readonly sseOptions?: Sse.DecodeOptions | undefined };

export type HttpStreamPolicy<Endpoint> = StreamedPolicyOptions &
  HttpDecoderPolicy<Endpoint>;

export type HttpStreamQueryError<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  ClientError,
> =
  | EffectHttpApiQueryConfigError
  | Failure<ClientError | StreamFailure<Success<Endpoint>>>;

export type StreamedKey<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = DataTag<
  HasRequest<Endpoint> extends false
    ? readonly [...Key, "streamed", unknown]
    : readonly [...Key, "streamed", unknown, unknown],
  readonly StreamChunk<Success<Endpoint>>[],
  HttpStreamQueryError<Endpoint, ClientError>
>;

export type StreamedLeaf<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = {
  readonly key: () => Key;

  /** Builds native filters for this streaming HTTP endpoint. */
  readonly queryFilter: LeafQueryFilter<
    Request<Endpoint>,
    HasRequest<Endpoint> extends false ? true : false,
    "live" | "streamed",
    {
      readonly live: HttpDecoderPolicy<Endpoint> & LivePolicyOptions;
      readonly streamed: StreamedFilterPolicy<HttpStreamPolicy<Endpoint>>;
    }
  >;

  readonly streamedKey: HasRequest<Endpoint> extends false
    ? (
        policy: HttpStreamPolicy<Endpoint>
      ) => StreamedKey<Endpoint, Key, ClientError>
    : (
        options: {
          readonly input: Request<Endpoint> | PreparedInput<Request<Endpoint>>;
        } & HttpStreamPolicy<Endpoint>
      ) => StreamedKey<Endpoint, Key, ClientError>;
  readonly streamedOptions: UnaryQueryBuilder<
    Request<Endpoint>,
    readonly StreamChunk<Success<Endpoint>>[],
    HttpStreamQueryError<Endpoint, ClientError>,
    StreamedKey<Endpoint, Key, ClientError>,
    readonly [...Key, "streamed"],
    HttpStreamPolicy<Endpoint>,
    HasRequest<Endpoint> extends false ? true : false
  >;
};

export type LiveFailure<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  ClientError,
> =
  | HttpStreamQueryError<Endpoint, ClientError>
  | EffectHttpApiQueryEmptyStreamError;

export type LiveKey<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = DataTag<
  HasRequest<Endpoint> extends false
    ? readonly [...Key, "live", unknown]
    : readonly [...Key, "live", unknown, unknown],
  QueryData<StreamChunk<Success<Endpoint>>>,
  LiveFailure<Endpoint, ClientError>
>;

export type LiveLeaf<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  ClientError,
> = {
  readonly liveKey: HasRequest<Endpoint> extends false
    ? (
        policy?: HttpDecoderPolicy<Endpoint> & LivePolicyOptions
      ) => LiveKey<Endpoint, Key, ClientError>
    : (
        options: {
          readonly input: Request<Endpoint> | PreparedInput<Request<Endpoint>>;
        } & HttpDecoderPolicy<Endpoint> &
          LivePolicyOptions
      ) => LiveKey<Endpoint, Key, ClientError>;
  readonly liveOptions: UnaryQueryBuilder<
    Request<Endpoint>,
    QueryData<StreamChunk<Success<Endpoint>>>,
    LiveFailure<Endpoint, ClientError>,
    LiveKey<Endpoint, Key, ClientError>,
    readonly [...Key, "live"],
    HttpDecoderPolicy<Endpoint> & LivePolicyOptions,
    HasRequest<Endpoint> extends false ? true : false
  >;
};

export type StandardClientParts<Api extends HttpApi.Constraint, Client> =
  Client extends HttpApiClient.ForApi<Api, infer E, infer R>
    ? Types.Equals<Client, HttpApiClient.ForApi<Api, E, R>> extends true
      ? readonly [E, R]
      : false
    : false;

export type ResolvedLeafParts<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Method,
  Standard,
> = [Standard] extends [readonly [infer E, infer R]]
  ? readonly [
      StandardEndpointError<Endpoint, E>,
      StandardEndpointError<Endpoint, E>,
      StandardEndpointServices<Endpoint, R>,
    ]
  : StandardMethodParts<Method, Endpoint> extends readonly [infer E, infer R]
    ? readonly [
        StandardEndpointError<Endpoint, E>,
        StandardEndpointError<Endpoint, E>,
        StandardEndpointServices<Endpoint, R>,
      ]
    : ResolveMethodEffects<Method, Endpoint> extends readonly [
          infer Decoded,
          infer Metadata,
        ]
      ? readonly [
          [StreamingEndpoint<Endpoint>] extends [never]
            ? Effect.Error<Decoded>
            : Effect.Error<Decoded> | StreamFailure<Effect.Success<Decoded>>,
          Effect.Error<Metadata>,
          Effect.Services<Decoded>,
        ]
      : readonly [never, never, never];

export type EndpointLeaf<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Key extends readonly JsonValue[],
  Method,
  Standard = false,
> =
  ResolvedLeafParts<Endpoint, Method, Standard> extends infer Parts extends
    readonly [unknown, unknown, unknown]
    ? [StreamingEndpoint<Endpoint>] extends [never]
      ? BufferedLeaf<Endpoint, Key, Parts[0], Parts[1], Parts[2]>
      : StreamedLeaf<Endpoint, Key, Parts[0]> &
          LiveLeaf<Endpoint, Key, Parts[0]>
    : never;

export type HttpGroupPaths<Group extends HttpApiGroup.Constraint> = Supported<
  Endpoints<Group>
>["identifier"];

export type HttpApiPathsFromGroups<SupportedGroup> =
  SupportedGroup extends HttpApiGroup.Constraint
    ? SupportedGroup extends { readonly topLevel: true }
      ? HttpGroupPaths<SupportedGroup>
      :
          | SupportedGroup["identifier"]
          | `${SupportedGroup["identifier"]}.${HttpGroupPaths<SupportedGroup>}`
    : never;

export type GroupTree<
  RootKey extends readonly JsonValue[],
  Group extends HttpApiGroup.Constraint,
  GroupClient,
  Standard = false,
> = {
  readonly [utilityPaths]?: HttpGroupPaths<Group>;
  readonly key: () => readonly [...RootKey, Group["identifier"]];
  /** Builds native filters for descendant queries. */
  readonly queryFilter: BranchQueryFilter;
} & {
  readonly [
    Endpoint in Supported<Endpoints<Group>> as Endpoint["identifier"]
  ]: EndpointLeaf<
    Endpoint,
    UtilityOperationKey<
      RootKey,
      readonly [Group["identifier"], Endpoint["identifier"]]
    >,
    [Standard] extends [readonly [unknown, unknown]]
      ? never
      : Member<GroupClient, Endpoint["identifier"]>,
    [Standard] extends [readonly [unknown, unknown]]
      ? Standard
      : StandardGroupParts<Group, GroupClient>
  >;
};

declare const httpQueryClient: unique symbol;

export type HttpApiQueryUtilsResolved<
  RootKey extends readonly JsonValue[],
  SupportedGroup extends HttpApiGroup.Constraint,
  Client,
  Standard,
> = {
  readonly [httpQueryClient]?: Client;
  readonly [utilityPaths]?: HttpApiPathsFromGroups<SupportedGroup>;
  readonly key: () => RootKey;
  /** Builds native filters for descendant queries. */
  readonly queryFilter: BranchQueryFilter;
} & {
  readonly [
    Group in Extract<
      SupportedGroup,
      { readonly topLevel: false }
    > as Group["identifier"]
  ]: GroupTree<RootKey, Group, Member<Client, Group["identifier"]>, Standard>;
} & {
  readonly [
    Endpoint in Supported<
      Endpoints<Extract<SupportedGroup, { readonly topLevel: true }>>
    > as Endpoint["identifier"]
  ]: EndpointLeaf<
    Endpoint,
    UtilityOperationKey<RootKey, readonly [Endpoint["identifier"]]>,
    [Standard] extends [readonly [unknown, unknown]]
      ? never
      : Member<Client, Endpoint["identifier"]>,
    Standard
  >;
};

/** A utility tree with lazy-memoized frozen leaves mirroring the ready HTTP client's literal properties. */
export type HttpApiQueryUtils<
  Api extends HttpApi.Constraint,
  Prefix extends OptionalKeyPrefix = readonly [],
  Client = HttpApiClient.ForApi<Api>,
> = HttpApiQueryUtilsResolved<
  Root<Api, Prefix>,
  SupportedGroups<Api>,
  Client,
  StandardClientParts<Api, Client>
>;

/** Projects a complete decoded HTTP request into safe, synchronous cache identity. */
export type HttpApiKeyEncoder<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
> = (input: Request<Endpoint>) => JsonValue;

export type InputEndpoints<Group> =
  Queryable<Supported<Endpoints<Group>>> extends infer Endpoint
    ? Endpoint extends HttpApiEndpoint.ConstraintRequest
      ? HasRequest<Endpoint> extends true
        ? Endpoint
        : never
      : never
    : never;
export type EncodingServices<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
> =
  | Endpoint["~Params"]["EncodingServices"]
  | Endpoint["~Query"]["EncodingServices"]
  | Endpoint["~Payload"]["EncodingServices"]
  | Endpoint["~Headers"]["EncodingServices"];
export type IsUnion<Value, Whole = Value> = Value extends Whole
  ? [Whole] extends [Value]
    ? false
    : true
  : never;
export type PayloadSchemas<S> = S extends {
  readonly schema: infer Inner extends Schema.Constraint;
}
  ? Inner
  : S;
export type RequiredEncodersFrom<Eligible> = Eligible extends infer Endpoint
  ? Endpoint extends HttpApiEndpoint.ConstraintRequest
    ? [EncodingServices<Endpoint>] extends [never]
      ? true extends
          | ContainsRedacted<
              | Endpoint["~Params"]["Type"]
              | Endpoint["~Query"]["Type"]
              | Endpoint["~Payload"]["Type"]
              | Endpoint["~Headers"]["Type"]
            >
          | IsUnion<PayloadSchemas<Endpoint["~Payload"]>>
        ? Endpoint
        : never
      : Endpoint
    : never
  : never;
export type RequiredEncoders<Group> = RequiredEncodersFrom<
  InputEndpoints<Group>
>;
export type GroupEncoders<Group> =
  InputEndpoints<Group> extends infer Eligible extends
    HttpApiEndpoint.ConstraintRequest
    ? RequiredEncodersFrom<Eligible> extends infer Required extends
        HttpApiEndpoint.ConstraintRequest
      ? ([Required] extends [never]
          ? unknown
          : {
              readonly [
                Endpoint in Required as Endpoint["identifier"]
              ]: HttpApiKeyEncoder<Endpoint>;
            }) & {
          readonly [
            Endpoint in [Required] extends [never]
              ? Eligible
              : Exclude<Eligible, Required> as Endpoint["identifier"]
          ]?: HttpApiKeyEncoder<Endpoint>;
        }
      : never
    : never;
export type EncoderGroups<Api extends HttpApi.Constraint> =
  SupportedGroups<Api> extends infer Group
    ? Group extends HttpApiGroup.Constraint
      ? [InputEndpoints<Group>] extends [never]
        ? never
        : Group
      : never
    : never;
export type RequiredEncoderGroupsFrom<EligibleGroups> =
  EligibleGroups extends infer Group
    ? Group extends HttpApiGroup.Constraint
      ? [RequiredEncoders<Group>] extends [never]
        ? never
        : Group
      : never
    : never;
export type EncodersFrom<EligibleGroups, RequiredGroups> = ([
  RequiredGroups,
] extends [never]
  ? unknown
  : {
      readonly [
        Group in Extract<
          RequiredGroups,
          HttpApiGroup.Constraint
        > as Group["identifier"]
      ]: GroupEncoders<Group>;
    }) & {
  readonly [
    Group in [RequiredGroups] extends [never]
      ? Extract<EligibleGroups, HttpApiGroup.Constraint>
      : Exclude<
          Extract<EligibleGroups, HttpApiGroup.Constraint>,
          RequiredGroups
        > as Group["identifier"]
  ]?: GroupEncoders<Group>;
};
export type EncoderOption<Api extends HttpApi.Constraint> =
  EncoderGroups<Api> extends infer Eligible
    ? RequiredEncoderGroupsFrom<Eligible> extends infer Required
      ? KeyEncoderRequirement<
          Eligible,
          Required,
          EncodersFrom<Eligible, Required>
        >
      : never
    : never;
export type StreamServices<Value> =
  Value extends HttpApiSchema.withHeaders<infer Body, infer _Headers>
    ? StreamServices<Body>
    : Value extends Stream.Stream<infer _Chunk, infer _Error, infer Services>
      ? Services
      : never;

export type ExecutionServices<Value> =
  Value extends Effect.Effect<infer Data, infer _Error, infer Services>
    ? Services | StreamServices<Data>
    : never;

export type ClientServices<Api extends HttpApi.Constraint, Client> =
  Supported<Endpoints<Groups<Api>>> extends infer SupportedEndpoints
    ? StandardClientParts<Api, Client> extends readonly [infer _E, infer R]
      ?
          | HttpApiEndpoint.ClientServices<SupportedEndpoints>
          | HttpApiEndpoint.ErrorServicesDecode<SupportedEndpoints>
          | ([SupportedEndpoints] extends [never] ? never : R)
      :
          | HttpApiEndpoint.ClientServices<SupportedEndpoints>
          | HttpApiEndpoint.ErrorServicesDecode<SupportedEndpoints>
          | ExposedClientServices<Api, Client>
    : never;
export type RunnerOption<
  Api extends HttpApi.Constraint,
  Client,
> = RunnerRequirement<ClientServices<Api, Client>>;

export type HttpKeyPrefixOption<Prefix extends OptionalKeyPrefix> = [
  Prefix,
] extends [readonly []]
  ? { readonly keyPrefix?: never }
  : {
      /** A non-empty JSON-safe tuple that namespaces every generated key. */
      readonly keyPrefix: Prefix;
    };

/** Derives HTTP utilities while the caller retains client and runtime ownership. */
export type CreateHttpApiQueryUtilsOptions<
  Api extends HttpApi.Constraint,
  Prefix extends OptionalKeyPrefix = readonly [],
  Client = HttpApiClient.ForApi<Api>,
> = {
  readonly client: Client & HttpApiClient.ForApi<Api, unknown, unknown>;
} & HttpKeyPrefixOption<Prefix> &
  EncoderOption<Api> &
  RunnerOption<Api, NoInfer<Client>>;
