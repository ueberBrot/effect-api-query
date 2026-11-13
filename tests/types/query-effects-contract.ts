import type { QueryClient } from "@tanstack/query-core";
import {
  queryEffects,
  QueryClientService,
  QueryClientOperationError,
  createRpcQueryUtils,
  createHttpApiQueryUtils,
} from "@ueberbrot/effect-api-query";
import type {
  EffectRpcQueryError,
  InferQueryError,
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
export type FetchData = Assert<
  Equal<Effect.Success<typeof fetched>, number | null>
>;
export type EnsureData = Assert<
  Equal<Effect.Success<typeof ensured>, number | null>
>;
export type ReadData = Assert<
  Equal<Effect.Success<typeof read>, number | null | undefined>
>;
export type UpdateData = Assert<
  Equal<Effect.Success<typeof updated>, number | null | undefined>
>;
export type FetchError = Assert<
  Equal<
    Effect.Error<typeof fetched>,
    EffectRpcQueryError<"missing"> | QueryClientOperationError
  >
>;
export type FetchServices = Assert<
  Equal<Effect.Services<typeof fetched>, QueryClientService>
>;
// @ts-expect-error Selected strings are not cache data
export const wrongValue = queryEffects.setData(options.queryKey, "selected");
export const wrongUpdater = queryEffects.setData(
  options.queryKey,
  // @ts-expect-error Updaters cannot replace decoded cache values with selection
  () => "selected"
);
declare const queryClient: QueryClient;
const supplied = fetched.pipe(
  Effect.provideService(QueryClientService, queryClient)
);
export type Supplied = Assert<Equal<Effect.Services<typeof supplied>, never>>;

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
export type HttpData = Assert<Equal<Effect.Success<typeof httpEffect>, number>>;
export type HttpError = Assert<
  Equal<
    Effect.Error<typeof httpEffect>,
    InferQueryError<typeof http.users.read> | QueryClientOperationError
  >
>;

class Domain extends Context.Service<Domain, { readonly name: string }>()(
  "QueryEffectsContract/Domain"
) {}
const composed = Effect.gen(function* () {
  yield* Domain;
  return yield* ensured;
});
export type ComposedServices = Assert<
  Equal<Effect.Services<typeof composed>, Domain | QueryClientService>
>;
