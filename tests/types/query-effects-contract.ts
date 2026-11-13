import type { QueryClient } from "@tanstack/query-core";
import {
  queryEffects,
  QueryClientService,
  QueryClientOperationError,
  createRpcQueryUtils,
  createHttpApiQueryUtils,
} from "@ueberbrot/effect-api-query";
import { Context, Effect, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;
const group = RpcGroup.make(
  Rpc.make("read", {
    success: Schema.UndefinedOr(Schema.Int),
    error: Schema.Literal("missing"),
  })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const utils = createRpcQueryUtils(group, { client, keyPrefix: ["effects"] });
const options = utils.read.queryOptions({ select: (value) => String(value) });
const fetched = queryEffects.fetch(options);
const ensured = queryEffects.ensure(options);
const read = queryEffects.getData(options.queryKey);
const updated = queryEffects.setData(options.queryKey, (old) =>
  old === undefined ? 1 : old
);
type FetchData = Assert<Equal<Effect.Success<typeof fetched>, number | null>>;
type EnsureData = Assert<Equal<Effect.Success<typeof ensured>, number | null>>;
type ReadData = Assert<
  Equal<Effect.Success<typeof read>, number | null | undefined>
>;
type UpdateData = Assert<
  Equal<Effect.Success<typeof updated>, number | null | undefined>
>;
type FetchError = Assert<
  Equal<Effect.Error<typeof fetched>, QueryClientOperationError>
>;
type FetchServices = Assert<
  Equal<Effect.Services<typeof fetched>, QueryClientService>
>;
// @ts-expect-error Selected strings are not cache data
const wrongValue = queryEffects.setData(options.queryKey, "selected");
const wrongUpdater = queryEffects.setData(
  options.queryKey,
  // @ts-expect-error Updaters cannot replace decoded cache values with selection
  () => "selected"
);
declare const queryClient: QueryClient;
const supplied = fetched.pipe(
  Effect.provideService(QueryClientService, queryClient)
);
type Supplied = Assert<Equal<Effect.Services<typeof supplied>, never>>;

const api = HttpApi.make("bridge").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("read", "/users", { success: Schema.Int })
  )
);
declare const httpClient: HttpApiClient.ForApi<typeof api>;
const http = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ["http"],
});
const httpEffect = queryEffects.ensure(
  http.users.read.queryOptions({ select: String })
);
type HttpData = Assert<Equal<Effect.Success<typeof httpEffect>, number>>;
type HttpError = Assert<
  Equal<Effect.Error<typeof httpEffect>, QueryClientOperationError>
>;

class Domain extends Context.Service<Domain, { readonly name: string }>()(
  "QueryEffectsContract/Domain"
) {}
const composed = Effect.gen(function* () {
  yield* Domain;
  return yield* ensured;
});
type ComposedServices = Assert<
  Equal<Effect.Services<typeof composed>, Domain | QueryClientService>
>;

type EnsureError = Assert<
  Equal<Effect.Error<typeof ensured>, QueryClientOperationError>
>;
type RejectionCause = Assert<
  Equal<Effect.Error<typeof fetched>["cause"], unknown>
>;
type NoDeclaredPayloadClaim = Assert<
  Equal<
    Effect.Error<
      typeof fetched
    > extends import("@ueberbrot/effect-api-query").EffectRpcQueryError<"missing">
      ? true
      : false,
    false
  >
>;
type NativeDeclaredError = Assert<
  Equal<
    import("@ueberbrot/effect-api-query").InferQueryError<typeof utils.read>,
    import("@ueberbrot/effect-api-query").EffectRpcQueryError<"missing">
  >
>;
