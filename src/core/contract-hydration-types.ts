import type { Schema } from "effect";
import type {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import type { Rpc, RpcGroup, RpcSchema } from "effect/rpc";

import type {
  Endpoints,
  MetadataData,
  Queryable,
  StreamChunk,
  StreamingEndpoint,
  Success as HttpSuccess,
  SuccessSchema as HttpSuccessSchema,
  Supported,
  SupportedGroups,
} from "../http/types";
import type { RpcsOf, StreamingRpc } from "../rpc/types";
import type { KeyPrefix, KeysOfUnion, QueryData } from "./types";

export type ServiceChannel = "DecodingServices" | "EncodingServices";

export type AnyCodec = Schema.Codec<unknown, unknown, unknown, unknown>;

export type ExactKeys<Actual, Allowed extends PropertyKey> = {
  readonly [Key in Exclude<KeysOfUnion<NonNullable<Actual>>, Allowed>]: never;
};

export type PropOf<Value, Key extends PropertyKey> = Value extends object
  ? Key extends keyof Value
    ? Value[Key]
    : undefined
  : undefined;

export type ViewEnabled<Views, Key extends string> = [Views] extends [undefined]
  ? true
  : Views extends object
    ? Key extends keyof Views
      ? [Views[Key]] extends [false]
        ? false
        : true
      : true
    : true;

export type ExactCodec<Data, Actual> = Actual extends unknown
  ? Actual extends false | undefined
    ? Actual
    : Actual extends Schema.Codec<infer Type, unknown, unknown, unknown>
      ? [Type] extends [Data]
        ? [Data] extends [Type]
          ? Actual
          : Schema.Codec<Data, unknown, unknown, unknown>
        : Schema.Codec<Data, unknown, unknown, unknown>
      : Schema.Codec<Data, unknown, unknown, unknown>
  : never;

export type CodecServices<
  Codec,
  Channel extends ServiceChannel,
> = Codec extends Schema.Constraint ? Codec[Channel] : never;

export type InfiniteConfigConstraint<PageData, Actual> = Actual extends unknown
  ? Actual extends false | undefined
    ? Actual
    : {
        readonly pageParam: AnyCodec;
        readonly page?: ExactCodec<PageData, PropOf<Actual, "page">>;
      } & ExactKeys<Actual, "pageParam" | "page">
  : never;

export type GuaranteedModifiedKeys<Paths> = Paths extends object
  ? {
      readonly [Key in keyof Paths & string]: [
        Extract<Paths[Key], undefined>,
      ] extends [never]
        ? Key
        : never;
    }[keyof Paths & string]
  : never;

export type ResolveViewServices<
  Override,
  Fallback,
  Enabled extends boolean,
  Channel extends ServiceChannel,
> = Override extends unknown
  ? Override extends false
    ? never
    : Override extends undefined
      ? Enabled extends true
        ? Fallback
        : never
      : CodecServices<Override, Channel>
  : never;

export type ResolveInheritedDataServices<
  QueryOverride,
  ContractServices,
  Channel extends ServiceChannel,
> = QueryOverride extends unknown
  ? QueryOverride extends false | undefined
    ? ContractServices
    : CodecServices<QueryOverride, Channel>
  : never;

export type ResolveInfiniteServices<
  InfiniteConfig,
  QueryOverride,
  ContractServices,
  Channel extends ServiceChannel,
> = InfiniteConfig extends unknown
  ? InfiniteConfig extends false | undefined
    ? never
    :
        | CodecServices<PropOf<InfiniteConfig, "pageParam">, Channel>
        | (PropOf<InfiniteConfig, "page"> extends infer PageOverride
            ? PageOverride extends unknown
              ? PageOverride extends undefined
                ? ResolveInheritedDataServices<
                    QueryOverride,
                    ContractServices,
                    Channel
                  >
                : CodecServices<PageOverride, Channel>
              : never
            : never)
  : never;

/** Top-level view toggles for RPC contract hydration registries. */
export interface RpcContractHydrationViews {
  readonly query?: boolean;
  readonly live?: boolean;
  readonly streamed?: boolean;
}

/** Top-level view toggles for HTTP contract hydration registries. */
export interface HttpContractHydrationViews {
  readonly query?: boolean;
  readonly metadata?: boolean;
  readonly live?: boolean;
  readonly streamed?: boolean;
}

export type RpcUnaryPathConfig<
  R extends Rpc.Any,
  Actual,
> = Actual extends unknown
  ? Actual extends false | undefined
    ? Actual
    : {
        readonly query?:
          | false
          | ExactCodec<QueryData<Rpc.Success<R>>, PropOf<Actual, "query">>;
        readonly infinite?: InfiniteConfigConstraint<
          QueryData<Rpc.Success<R>>,
          PropOf<Actual, "infinite">
        >;
      } & ExactKeys<Actual, "query" | "infinite">
  : never;

export type RpcStreamPathConfig<
  R extends Rpc.Any,
  Actual,
> = Actual extends unknown
  ? Actual extends false | undefined
    ? Actual
    : {
        readonly live?:
          | false
          | ExactCodec<QueryData<Rpc.SuccessChunk<R>>, PropOf<Actual, "live">>;
        readonly streamed?:
          | false
          | ExactCodec<
              readonly Rpc.SuccessChunk<R>[],
              PropOf<Actual, "streamed">
            >;
      } & ExactKeys<Actual, "live" | "streamed">
  : never;

export type RpcPathConfig<R extends Rpc.Any, Actual> = [
  StreamingRpc<R>,
] extends [never]
  ? RpcUnaryPathConfig<R, Actual>
  : RpcStreamPathConfig<R, Actual>;

export type RpcPathsConstraint<
  Group extends RpcGroup.Any,
  ActualPaths,
> = ActualPaths extends undefined
  ? undefined
  : {
      readonly [
        Path in keyof ActualPaths & RpcsOf<Group>["_tag"]
      ]?: RpcPathConfig<
        Extract<RpcsOf<Group>, { readonly _tag: Path }>,
        ActualPaths[Path]
      >;
    } & ExactKeys<ActualPaths, RpcsOf<Group>["_tag"]>;

export type ValidateKeyPrefix<Actual> = "keyPrefix" extends keyof Actual
  ? Actual["keyPrefix"] extends KeyPrefix
    ? Actual["keyPrefix"]
    : KeyPrefix
  : KeyPrefix;

export type ValidateViews<
  ActualViews,
  Allowed extends PropertyKey,
> = ActualViews extends undefined
  ? undefined
  : {
      readonly [Key in keyof ActualViews & Allowed]?: ActualViews[Key] extends
        | boolean
        | undefined
        ? ActualViews[Key]
        : boolean;
    } & ExactKeys<ActualViews, Allowed>;

/** Configuration for deriving a hydration registry from an Effect `RpcGroup`. */
export type RpcContractHydrationOptions<
  Group extends RpcGroup.Any,
  Actual = unknown,
> = {
  readonly keyPrefix?: ValidateKeyPrefix<Actual>;
  readonly views?: ValidateViews<
    PropOf<Actual, "views">,
    keyof RpcContractHydrationViews
  >;
  readonly paths?: RpcPathsConstraint<Group, PropOf<Actual, "paths">>;
} & ExactKeys<Actual, "keyPrefix" | "views" | "paths">;

export type RpcSchemaServices<
  R extends Rpc.Any,
  Channel extends ServiceChannel,
> = R extends Rpc.Any
  ? Rpc.SuccessSchema<R> extends RpcSchema.Stream<
      infer A extends Schema.Constraint,
      Schema.Constraint
    >
    ? A[Channel]
    : Rpc.SuccessSchema<R>[Channel]
  : never;

export type RpcUnmodifiedServices<
  R extends Rpc.Any,
  Views,
  Channel extends ServiceChannel,
> = R extends Rpc.Any
  ? [StreamingRpc<R>] extends [never]
    ? true extends ViewEnabled<Views, "query">
      ? RpcSchemaServices<R, Channel>
      : never
    : true extends ViewEnabled<Views, "live"> | ViewEnabled<Views, "streamed">
      ? RpcSchemaServices<R, Channel>
      : never
  : never;

export type RpcModifiedPathServices<
  R extends Rpc.Any,
  Config,
  Views,
  Channel extends ServiceChannel,
> = Config extends unknown
  ? Config extends false
    ? never
    : Config extends undefined
      ? RpcUnmodifiedServices<R, Views, Channel>
      : [StreamingRpc<R>] extends [never]
        ?
            | ResolveViewServices<
                PropOf<Config, "query">,
                RpcSchemaServices<R, Channel>,
                ViewEnabled<Views, "query">,
                Channel
              >
            | ResolveInfiniteServices<
                PropOf<Config, "infinite">,
                PropOf<Config, "query">,
                RpcSchemaServices<R, Channel>,
                Channel
              >
        :
            | ResolveViewServices<
                PropOf<Config, "live">,
                RpcSchemaServices<R, Channel>,
                ViewEnabled<Views, "live">,
                Channel
              >
            | ResolveViewServices<
                PropOf<Config, "streamed">,
                RpcSchemaServices<R, Channel>,
                ViewEnabled<Views, "streamed">,
                Channel
              >
  : never;

export type RpcOptionsServices<
  Group extends RpcGroup.Any,
  Options,
  Channel extends ServiceChannel,
> = Options extends unknown
  ? Options extends undefined
    ? RpcSchemaServices<RpcsOf<Group>, Channel>
    : PropOf<Options, "views"> extends infer Views
      ? PropOf<Options, "paths"> extends infer Paths
        ? [Paths] extends [undefined]
          ? RpcUnmodifiedServices<RpcsOf<Group>, Views, Channel>
          :
              | RpcUnmodifiedServices<
                  Exclude<
                    RpcsOf<Group>,
                    {
                      readonly _tag: [Extract<Paths, undefined>] extends [never]
                        ? GuaranteedModifiedKeys<Paths>
                        : never;
                    }
                  >,
                  Views,
                  Channel
                >
              | (NonNullable<Paths> extends infer DefinedPaths
                  ? DefinedPaths extends object
                    ? {
                        readonly [
                          Path in keyof DefinedPaths & RpcsOf<Group>["_tag"]
                        ]: RpcModifiedPathServices<
                          Extract<RpcsOf<Group>, { readonly _tag: Path }>,
                          DefinedPaths[Path],
                          Views,
                          Channel
                        >;
                      }[keyof DefinedPaths & RpcsOf<Group>["_tag"]]
                    : never
                  : never)
        : never
      : never
  : never;

export type RpcContractDecodingServices<Group extends RpcGroup.Any, Options> = [
  Options,
] extends [undefined]
  ? RpcSchemaServices<RpcsOf<Group>, "DecodingServices">
  : RpcOptionsServices<Group, Options, "DecodingServices">;

export type RpcContractEncodingServices<Group extends RpcGroup.Any, Options> = [
  Options,
] extends [undefined]
  ? RpcSchemaServices<RpcsOf<Group>, "EncodingServices">
  : RpcOptionsServices<Group, Options, "EncodingServices">;

export type HttpHydrationGroupPaths<Group extends HttpApiGroup.Constraint> =
  Group extends HttpApiGroup.Constraint
    ? Group extends { readonly topLevel: true }
      ? Queryable<Supported<Endpoints<Group>>>["identifier"]
      : `${Group["identifier"]}.${Queryable<Supported<Endpoints<Group>>>["identifier"]}`
    : never;

export type HttpContractPaths<Api extends HttpApi.Constraint> =
  HttpHydrationGroupPaths<SupportedGroups<Api>>;

export type HttpEndpointAtPath<
  Api extends HttpApi.Constraint,
  Path extends string,
> =
  SupportedGroups<Api> extends infer Group
    ? Group extends HttpApiGroup.Constraint
      ? Group extends { readonly topLevel: true }
        ? Extract<
            Queryable<Supported<Endpoints<Group>>>,
            { readonly identifier: Path }
          >
        : Path extends `${Group["identifier"]}.${infer EndpointId}`
          ? Extract<
              Queryable<Supported<Endpoints<Group>>>,
              { readonly identifier: EndpointId }
            >
          : never
      : never
    : never;

export type GroupModifiedEndpointIds<
  Group extends HttpApiGroup.Constraint,
  ModifiedPaths extends string,
> = Group extends { readonly topLevel: true }
  ? ModifiedPaths
  : ModifiedPaths extends `${Group["identifier"]}.${infer EndpointId}`
    ? EndpointId
    : never;

export type UnmodifiedGroupEndpoints<
  Group extends HttpApiGroup.Constraint,
  ModifiedPaths extends string,
> = Exclude<
  Queryable<Supported<Endpoints<Group>>>,
  { readonly identifier: GroupModifiedEndpointIds<Group, ModifiedPaths> }
>;

export type HttpBufferedPathConfig<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Actual,
> = Actual extends unknown
  ? Actual extends false | undefined
    ? Actual
    : {
        readonly query?:
          | false
          | ExactCodec<
              QueryData<HttpSuccess<Endpoint>>,
              PropOf<Actual, "query">
            >;
        readonly metadata?:
          | false
          | ExactCodec<MetadataData<Endpoint>, PropOf<Actual, "metadata">>;
        readonly infinite?: InfiniteConfigConstraint<
          QueryData<HttpSuccess<Endpoint>>,
          PropOf<Actual, "infinite">
        >;
      } & ExactKeys<Actual, "query" | "metadata" | "infinite">
  : never;

export type HttpStreamPathConfig<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Actual,
> = Actual extends unknown
  ? Actual extends false | undefined
    ? Actual
    : {
        readonly live?:
          | false
          | ExactCodec<
              QueryData<StreamChunk<HttpSuccess<Endpoint>>>,
              PropOf<Actual, "live">
            >;
        readonly streamed?:
          | false
          | ExactCodec<
              readonly StreamChunk<HttpSuccess<Endpoint>>[],
              PropOf<Actual, "streamed">
            >;
      } & ExactKeys<Actual, "live" | "streamed">
  : never;

export type HttpPathConfig<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Actual,
> = [StreamingEndpoint<Endpoint>] extends [never]
  ? HttpBufferedPathConfig<Endpoint, Actual>
  : HttpStreamPathConfig<Endpoint, Actual>;

export type HttpPathsConstraint<
  Api extends HttpApi.Constraint,
  ActualPaths,
> = ActualPaths extends undefined
  ? undefined
  : {
      readonly [
        Path in keyof ActualPaths & HttpContractPaths<Api>
      ]?: HttpPathConfig<HttpEndpointAtPath<Api, Path>, ActualPaths[Path]>;
    } & ExactKeys<ActualPaths, HttpContractPaths<Api>>;

/** Configuration for deriving a hydration registry from an Effect `HttpApi`. */
export type HttpContractHydrationOptions<
  Api extends HttpApi.Constraint,
  Actual = unknown,
> = {
  readonly keyPrefix?: ValidateKeyPrefix<Actual>;
  readonly views?: ValidateViews<
    PropOf<Actual, "views">,
    keyof HttpContractHydrationViews
  >;
  readonly paths?: HttpPathsConstraint<Api, PropOf<Actual, "paths">>;
} & ExactKeys<Actual, "keyPrefix" | "views" | "paths">;

export type HttpBodyServices<S, Channel extends ServiceChannel> =
  S extends HttpApiSchema.StreamSse<infer Events, Schema.Constraint, unknown>
    ? Events extends Schema.Constraint
      ? Events[Channel]
      : never
    : S extends HttpApiSchema.StreamNdjson<
          infer Inner extends Schema.Constraint
        >
      ? Inner[Channel]
      : S extends Schema.Constraint
        ? S[Channel]
        : never;

export type HttpSuccessSchemaServices<
  S,
  Channel extends ServiceChannel,
> = S extends unknown
  ? S extends HttpApiSchema.WithHeaders<infer Body, infer Headers>
    ? HttpBodyServices<Body, Channel> | Headers[Channel]
    : HttpBodyServices<S, Channel>
  : never;

export type HttpEndpointSchemaServices<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Channel extends ServiceChannel,
> = Endpoint extends HttpApiEndpoint.ConstraintRequest
  ? HttpSuccessSchemaServices<HttpSuccessSchema<Endpoint>, Channel>
  : never;

export type HttpEndpointUnmodifiedServices<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Views,
  Channel extends ServiceChannel,
> = Endpoint extends HttpApiEndpoint.ConstraintRequest
  ? [StreamingEndpoint<Endpoint>] extends [never]
    ? true extends ViewEnabled<Views, "query"> | ViewEnabled<Views, "metadata">
      ? HttpEndpointSchemaServices<Endpoint, Channel>
      : never
    : true extends ViewEnabled<Views, "live"> | ViewEnabled<Views, "streamed">
      ? HttpEndpointSchemaServices<Endpoint, Channel>
      : never
  : never;

export type HttpGroupBareServices<
  Group extends HttpApiGroup.Constraint,
  Channel extends ServiceChannel,
> = Group extends HttpApiGroup.Constraint
  ? HttpEndpointSchemaServices<Queryable<Supported<Endpoints<Group>>>, Channel>
  : never;

export type HttpGroupUnmodifiedServices<
  Group extends HttpApiGroup.Constraint,
  GuaranteedPaths extends string,
  Views,
  Channel extends ServiceChannel,
> = Group extends HttpApiGroup.Constraint
  ? HttpEndpointUnmodifiedServices<
      UnmodifiedGroupEndpoints<Group, GuaranteedPaths>,
      Views,
      Channel
    >
  : never;

export type HttpModifiedPathServices<
  Endpoint extends HttpApiEndpoint.ConstraintRequest,
  Config,
  Views,
  Channel extends ServiceChannel,
> = Config extends unknown
  ? Config extends false
    ? never
    : Config extends undefined
      ? HttpEndpointUnmodifiedServices<Endpoint, Views, Channel>
      : [StreamingEndpoint<Endpoint>] extends [never]
        ?
            | ResolveViewServices<
                PropOf<Config, "query">,
                HttpEndpointSchemaServices<Endpoint, Channel>,
                ViewEnabled<Views, "query">,
                Channel
              >
            | ResolveViewServices<
                PropOf<Config, "metadata">,
                ResolveInheritedDataServices<
                  PropOf<Config, "query">,
                  HttpEndpointSchemaServices<Endpoint, Channel>,
                  Channel
                >,
                ViewEnabled<Views, "metadata">,
                Channel
              >
            | ResolveInfiniteServices<
                PropOf<Config, "infinite">,
                PropOf<Config, "query">,
                HttpEndpointSchemaServices<Endpoint, Channel>,
                Channel
              >
        :
            | ResolveViewServices<
                PropOf<Config, "live">,
                HttpEndpointSchemaServices<Endpoint, Channel>,
                ViewEnabled<Views, "live">,
                Channel
              >
            | ResolveViewServices<
                PropOf<Config, "streamed">,
                HttpEndpointSchemaServices<Endpoint, Channel>,
                ViewEnabled<Views, "streamed">,
                Channel
              >
  : never;

export type HttpOptionsServices<
  Api extends HttpApi.Constraint,
  Options,
  Channel extends ServiceChannel,
> = Options extends unknown
  ? Options extends undefined
    ? HttpGroupBareServices<SupportedGroups<Api>, Channel>
    : PropOf<Options, "views"> extends infer Views
      ? PropOf<Options, "paths"> extends infer Paths
        ? [Paths] extends [undefined]
          ? HttpGroupUnmodifiedServices<
              SupportedGroups<Api>,
              never,
              Views,
              Channel
            >
          :
              | HttpGroupUnmodifiedServices<
                  SupportedGroups<Api>,
                  [Extract<Paths, undefined>] extends [never]
                    ? GuaranteedModifiedKeys<Paths>
                    : never,
                  Views,
                  Channel
                >
              | (NonNullable<Paths> extends infer DefinedPaths
                  ? DefinedPaths extends object
                    ? {
                        readonly [
                          Path in keyof DefinedPaths & string
                        ]: HttpModifiedPathServices<
                          HttpEndpointAtPath<Api, Path>,
                          DefinedPaths[Path],
                          Views,
                          Channel
                        >;
                      }[keyof DefinedPaths & string]
                    : never
                  : never)
        : never
      : never
  : never;

export type HttpContractDecodingServices<
  Api extends HttpApi.Constraint,
  Options,
> = [Options] extends [undefined]
  ? HttpGroupBareServices<SupportedGroups<Api>, "DecodingServices">
  : HttpOptionsServices<Api, Options, "DecodingServices">;

export type HttpContractEncodingServices<
  Api extends HttpApi.Constraint,
  Options,
> = [Options] extends [undefined]
  ? HttpGroupBareServices<SupportedGroups<Api>, "EncodingServices">
  : HttpOptionsServices<Api, Options, "EncodingServices">;
