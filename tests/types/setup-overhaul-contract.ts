import {
  acquireQueryOwner,
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  prepareInput,
  type EffectRpcQueryConfigError,
  type EffectRpcQueryEmptyStreamError,
  type EffectRpcQueryError,
  type HttpApiQueryUtils,
  type InferQueryError,
  type RpcQueryUtils,
  type RunPromiseExit,
  type RuntimeInput,
} from "@ueberbrot/effect-api-query";
import { Context, Effect, ManagedRuntime, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  type HttpApiClient,
} from "effect/http-api";
import {
  Rpc,
  RpcClient,
  RpcClientError,
  RpcGroup,
  RpcMiddleware,
  RpcSchema,
} from "effect/rpc";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

class ClientAuthMiddleware extends RpcMiddleware.Service<
  ClientAuthMiddleware,
  { clientError: "token-expired" }
>()("setup-overhaul/ClientAuthMiddleware", {
  error: Schema.Literal("server-auth-failed"),
  requiredForClient: true,
}) {}

class ServiceDep extends Context.Service<
  ServiceDep,
  { readonly tag: string }
>()("setup-overhaul/ServiceDep") {}

const ServicePayload = Schema.Struct({ id: Schema.Int }).pipe(
  Schema.middlewareEncoding<
    Schema.Struct<{ readonly id: Schema.Int }>,
    ServiceDep
  >((encoding) => Effect.flatMap(ServiceDep, () => encoding))
);

const rpcGroup = RpcGroup.make(
  Rpc.make("users.get", {
    payload: { id: Schema.Int },
    success: Schema.String,
    error: Schema.Literal("not-found"),
  }).middleware(ClientAuthMiddleware),
  Rpc.make("events.watch", {
    payload: { channel: Schema.String },
    success: RpcSchema.Stream(Schema.String, Schema.Literal("stream-broken")),
    error: Schema.Literal("watch-denied"),
  }).middleware(ClientAuthMiddleware),
  Rpc.make("health.ping")
);

const serviceRpcGroup = RpcGroup.make(
  Rpc.make("service.read", {
    payload: ServicePayload,
    success: Schema.String,
  })
);

type Rpcs = RpcGroup.Rpcs<typeof rpcGroup>;
type ServiceRpcs = RpcGroup.Rpcs<typeof serviceRpcGroup>;

declare const objectClient: RpcClient.RpcClient<
  Rpcs,
  RpcClientError.RpcClientError
>;
declare const flatClient: RpcClient.RpcClient.Flat<
  Rpcs,
  RpcClientError.RpcClientError
>;
declare const customObjectClient: RpcClient.RpcClient<Rpcs, "transport-down">;
declare const customFlatClient: RpcClient.RpcClient.Flat<
  Rpcs,
  "transport-down"
>;
declare const serviceObjectClient: RpcClient.RpcClient<ServiceRpcs, never>;

// 1. Optional keyPrefix on RPC (omitted -> readonly [], root ["rpc"])
const unprefixedObjectRpc = createRpcQueryUtils(rpcGroup, {
  client: objectClient,
});
const unprefixedFlatRpc = createRpcQueryUtils(rpcGroup, {
  client: flatClient,
});
true satisfies Assert<
  Equal<ReturnType<typeof unprefixedObjectRpc.key>, readonly ["rpc"]>
>;
true satisfies Assert<
  Equal<ReturnType<typeof unprefixedFlatRpc.key>, readonly ["rpc"]>
>;
const annotatedUnprefixedObject: RpcQueryUtils<
  typeof rpcGroup,
  readonly [],
  RpcClientError.RpcClientError
> = unprefixedObjectRpc;
const annotatedUnprefixedFlat: RpcQueryUtils<
  typeof rpcGroup,
  readonly [],
  RpcClientError.RpcClientError
> = unprefixedFlatRpc;
void [annotatedUnprefixedObject, annotatedUnprefixedFlat];

// Default Prefix parameter on RpcQueryUtils is readonly []
const defaultPrefixAnnotation: RpcQueryUtils<typeof rpcGroup> =
  createRpcQueryUtils(rpcGroup, {
    client: {} as RpcClient.RpcClient<Rpcs, never>,
  });
void defaultPrefixAnnotation;

// Prefixed RPC with both client shapes
const prefixedObjectRpc = createRpcQueryUtils(rpcGroup, {
  client: customObjectClient,
  keyPrefix: ["tenant-a"],
});
const prefixedFlatRpc = createRpcQueryUtils(rpcGroup, {
  client: customFlatClient,
  keyPrefix: ["tenant-a"],
});
true satisfies Assert<
  Equal<
    typeof prefixedObjectRpc,
    RpcQueryUtils<typeof rpcGroup, readonly ["tenant-a"], "transport-down">
  >
>;
true satisfies Assert<
  Equal<
    typeof prefixedFlatRpc,
    RpcQueryUtils<typeof rpcGroup, readonly ["tenant-a"], "transport-down">
  >
>;

// ClientMiddlewareError preserved on unary + streaming for BOTH object and flat clients
true satisfies Assert<
  Equal<
    InferQueryError<typeof prefixedObjectRpc.users.get>,
    EffectRpcQueryError<
      "not-found" | "server-auth-failed" | "token-expired" | "transport-down"
    >
  >
>;
true satisfies Assert<
  Equal<
    InferQueryError<typeof prefixedFlatRpc.users.get>,
    EffectRpcQueryError<
      "not-found" | "server-auth-failed" | "token-expired" | "transport-down"
    >
  >
>;
true satisfies Assert<
  Equal<
    InferQueryError<typeof prefixedObjectRpc.events.watch, "streamed">,
    | EffectRpcQueryConfigError
    | EffectRpcQueryError<
        | "stream-broken"
        | "watch-denied"
        | "server-auth-failed"
        | "token-expired"
        | "transport-down"
      >
  >
>;
true satisfies Assert<
  Equal<
    InferQueryError<typeof prefixedFlatRpc.events.watch, "live">,
    | EffectRpcQueryEmptyStreamError
    | EffectRpcQueryConfigError
    | EffectRpcQueryError<
        | "stream-broken"
        | "watch-denied"
        | "server-auth-failed"
        | "token-expired"
        | "transport-down"
      >
  >
>;

// makeNoSerialization (object and flat)
declare const noSerObject: Effect.Success<
  ReturnType<typeof RpcClient.makeNoSerialization<Rpcs, "no-ser-err", false>>
>["client"];
declare const noSerFlat: Effect.Success<
  ReturnType<typeof RpcClient.makeNoSerialization<Rpcs, "no-ser-err", true>>
>["client"];
const noSerObjectUtils = createRpcQueryUtils(rpcGroup, {
  client: noSerObject,
});
const noSerFlatUtils = createRpcQueryUtils(rpcGroup, {
  client: noSerFlat,
});
true satisfies Assert<
  Equal<
    typeof noSerObjectUtils,
    RpcQueryUtils<typeof rpcGroup, readonly [], "no-ser-err">
  >
>;
true satisfies Assert<
  Equal<
    typeof noSerFlatUtils,
    RpcQueryUtils<typeof rpcGroup, readonly [], "no-ser-err">
  >
>;

// Invalid keyPrefix rejections on RPC
declare const mutablePrefix: string[];
createRpcQueryUtils(rpcGroup, {
  client: objectClient,
  // @ts-expect-error empty tuple is rejected
  keyPrefix: [] as const,
});
createRpcQueryUtils(rpcGroup, {
  client: objectClient,
  // @ts-expect-error mutable string[] is rejected
  keyPrefix: mutablePrefix,
});
createRpcQueryUtils(rpcGroup, {
  client: objectClient,
  // @ts-expect-error explicit undefined is rejected under exactOptionalPropertyTypes
  keyPrefix: undefined,
});
declare const neverErrorObjectClient: RpcClient.RpcClient<Rpcs, never>;
// @ts-expect-error explicit prefix generic without keyPrefix is rejected
createRpcQueryUtils<typeof rpcGroup, readonly ["app"]>(rpcGroup, {
  client: neverErrorObjectClient,
});

// 2. Optional keyPrefix on HTTP
const httpApi = HttpApi.make("accounts").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("get", "/users/:id", {
      params: { id: Schema.Int },
      success: Schema.String,
    })
  )
);
declare const httpClient: HttpApiClient.ForApi<typeof httpApi>;
const unprefixedHttp = createHttpApiQueryUtils(httpApi, {
  client: httpClient,
});
true satisfies Assert<
  Equal<ReturnType<typeof unprefixedHttp.key>, readonly ["http", "accounts"]>
>;
const annotatedUnprefixedHttp: HttpApiQueryUtils<typeof httpApi> =
  unprefixedHttp;
void annotatedUnprefixedHttp;

createHttpApiQueryUtils(httpApi, {
  client: httpClient,
  // @ts-expect-error empty tuple is rejected
  keyPrefix: [] as const,
});
createHttpApiQueryUtils(httpApi, {
  client: httpClient,
  // @ts-expect-error mutable string[] is rejected
  keyPrefix: mutablePrefix,
});
// @ts-expect-error explicit undefined is rejected under exactOptionalPropertyTypes
createHttpApiQueryUtils(httpApi, { client: httpClient, keyPrefix: undefined });
// @ts-expect-error explicit prefix generic without keyPrefix is rejected
createHttpApiQueryUtils<typeof httpApi, readonly ["app"]>(httpApi, {
  client: httpClient,
});

// 3. Unified runtime option (RunPromiseExit, { runPromiseExit }, ManagedRuntime<R, never>)
declare const okRuntime: ManagedRuntime.ManagedRuntime<ServiceDep, never>;
declare const failingRuntime: ManagedRuntime.ManagedRuntime<
  ServiceDep,
  "layer-failed"
>;
declare const emptyRuntime: ManagedRuntime.ManagedRuntime<never, never>;
declare const objectRuntime: {
  readonly runPromiseExit: RunPromiseExit<ServiceDep>;
};

createRpcQueryUtils(serviceRpcGroup, {
  client: serviceObjectClient,
  keyEncoders: { "service.read": (p) => p.id },
  runtime: okRuntime,
});
createRpcQueryUtils(serviceRpcGroup, {
  client: serviceObjectClient,
  keyEncoders: { "service.read": (p) => p.id },
  runtime: objectRuntime,
});
// @effect-diagnostics missingEffectError:off missingEffectContext:off
createRpcQueryUtils(serviceRpcGroup, {
  client: serviceObjectClient,
  keyEncoders: { "service.read": (p) => p.id },
  // @ts-expect-error ManagedRuntime with non-never ER is rejected
  runtime: failingRuntime,
});
createRpcQueryUtils(serviceRpcGroup, {
  client: serviceObjectClient,
  keyEncoders: { "service.read": (p) => p.id },
  // @ts-expect-error ManagedRuntime missing required services is rejected
  runtime: emptyRuntime,
});
const run = Effect.runPromiseExit;
// @ts-expect-error superseded runPromiseExit option is removed
createRpcQueryUtils(rpcGroup, { client: objectClient, runPromiseExit: run });
createHttpApiQueryUtils(httpApi, {
  client: httpClient,
  runtime: emptyRuntime,
});
createHttpApiQueryUtils(httpApi, {
  client: httpClient,
  // @ts-expect-error ManagedRuntime with non-never ER is rejected
  runtime: failingRuntime,
});
createHttpApiQueryUtils(httpApi, {
  client: httpClient,
  // @ts-expect-error superseded runPromiseExit option is removed
  runPromiseExit: Effect.runPromiseExit,
});

// 4. QueryOwner.wrapRunner with RuntimeInput and QueryOwner.trackUtils composition
const owner = await acquireQueryOwner(async (setup) => {
  const wrappedFn = setup.wrapRunner(okRuntime);
  wrappedFn satisfies RunPromiseExit<ServiceDep>;
  const wrappedObj = setup.wrapRunner(objectRuntime);
  wrappedObj satisfies RunPromiseExit<ServiceDep>;
  // @ts-expect-error wrapRunner rejects ManagedRuntime with non-never ER
  setup.wrapRunner(failingRuntime);

  const trackedRoot = setup.trackUtils(unprefixedObjectRpc);
  const trackedBranch = setup.trackUtils(unprefixedObjectRpc.users);
  const trackedLeaf = setup.trackUtils(unprefixedObjectRpc.users.get);
  true satisfies Assert<Equal<typeof trackedRoot, typeof unprefixedObjectRpc>>;
  true satisfies Assert<
    Equal<typeof trackedBranch, typeof unprefixedObjectRpc.users>
  >;
  true satisfies Assert<
    Equal<typeof trackedLeaf, typeof unprefixedObjectRpc.users.get>
  >;

  const configuredFirst = setup.trackUtils(
    configureUtils(unprefixedObjectRpc, {
      streamed: { policy: { maxChunks: 10 } },
    })
  );
  const trackedFirst = configureUtils(setup.trackUtils(unprefixedObjectRpc), {
    streamed: { policy: { maxChunks: 10 } },
  });
  configuredFirst.events.watch.streamedOptions({ input: { channel: "a" } });
  trackedFirst.events.watch.streamedOptions({ input: { channel: "a" } });

  const prepared = prepareInput(trackedLeaf, { id: 1 });
  trackedLeaf.queryKey(prepared);
  configuredFirst.users.get.queryKey(prepared);

  return { trackedRoot, configuredFirst, trackedFirst };
});

const postTrackedHttp = owner.trackUtils(unprefixedHttp);
true satisfies Assert<Equal<typeof postTrackedHttp, typeof unprefixedHttp>>;
const runtimeInputCheck: RuntimeInput<ServiceDep> = okRuntime;
void runtimeInputCheck;
await owner.dispose();
