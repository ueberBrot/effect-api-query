import type {
  InfiniteData,
  QueryClient,
  QueryState,
} from "@tanstack/query-core";
import {
  queryEffects,
  skipToken,
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
const selected = queryEffects.query({ ...options, staleTime: "static" });
const state = queryEffects.getState(options.queryKey);
const read = queryEffects.getData(options.queryKey);
const updated = queryEffects.setData(options.queryKey, (old) =>
  old === undefined ? 1 : old
);
type SelectedData = Assert<Equal<Effect.Success<typeof selected>, string>>;
type State = Assert<
  Equal<
    Effect.Success<typeof state>,
    | QueryState<
        number | null,
        import("@ueberbrot/effect-api-query").EffectRpcQueryError<"missing">
      >
    | undefined
  >
>;
type ReadData = Assert<
  Equal<Effect.Success<typeof read>, number | null | undefined>
>;
type UpdateData = Assert<
  Equal<Effect.Success<typeof updated>, number | null | undefined>
>;
type QueryError = Assert<
  Equal<Effect.Error<typeof selected>, QueryClientOperationError>
>;
type QueryServices = Assert<
  Equal<Effect.Services<typeof selected>, QueryClientService>
>;
// @ts-expect-error Selected strings are not cache data
const wrongValue = queryEffects.setData(options.queryKey, "selected");
const wrongUpdater = queryEffects.setData(
  options.queryKey,
  // @ts-expect-error Updaters cannot replace decoded cache values with selection
  () => "selected"
);
declare const queryClient: QueryClient;
const supplied = selected.pipe(
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
const httpEffect = queryEffects.query(
  http.users.read.queryOptions({ select: String })
);
type HttpData = Assert<Equal<Effect.Success<typeof httpEffect>, string>>;
type HttpError = Assert<
  Equal<Effect.Error<typeof httpEffect>, QueryClientOperationError>
>;

class Domain extends Context.Service<Domain, { readonly name: string }>()(
  "QueryEffectsContract/Domain"
) {}
const composed = Effect.gen(function* () {
  yield* Domain;
  return yield* selected;
});
type ComposedServices = Assert<
  Equal<Effect.Services<typeof composed>, Domain | QueryClientService>
>;

type RejectionCause = Assert<
  Equal<Effect.Error<typeof selected>["cause"], unknown>
>;
type NoDeclaredPayloadClaim = Assert<
  Equal<
    Effect.Error<
      typeof selected
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

const infiniteOptions = {
  queryKey: ["pages"] as const,
  initialPageParam: "first",
  queryFn: async ({ pageParam }: { pageParam: string }) => pageParam,
  getNextPageParam: (last: string) => `${last}!`,
  pages: 2,
  staleTime: "static" as const,
};
const pages = queryEffects.infiniteQuery(infiniteOptions);
const total = queryEffects.infiniteQuery({
  ...infiniteOptions,
  select: ({ pages }) => pages.length,
});
const warmed = queryEffects.prefetch(options);
const warmedInfinite = queryEffects.prefetchInfinite(infiniteOptions);
type PageData = Assert<
  Equal<Effect.Success<typeof pages>, InfiniteData<string, string>>
>;
type PageSelection = Assert<Equal<Effect.Success<typeof total>, number>>;
type Prefetch = Assert<
  Equal<typeof warmed, Effect.Effect<void, never, QueryClientService>>
>;
type PrefetchInfinite = Assert<Equal<typeof warmedInfinite, typeof warmed>>;

type AcceptsSkip<
  Op extends "query" | "infiniteQuery" | "prefetch" | "prefetchInfinite",
> = typeof skipToken extends Parameters<(typeof queryEffects)[Op]>[0]["queryFn"]
  ? true
  : false;
type QueryRejectsSkip = Assert<Equal<AcceptsSkip<"query">, false>>;
type InfiniteRejectsSkip = Assert<Equal<AcceptsSkip<"infiniteQuery">, false>>;
type PrefetchRejectsSkip = Assert<Equal<AcceptsSkip<"prefetch">, false>>;
type PrefetchInfiniteRejectsSkip = Assert<
  Equal<AcceptsSkip<"prefetchInfinite">, false>
>;
type FetchingFilter = NonNullable<
  Parameters<typeof queryEffects.isFetching>[0]
>;
type FetchingFilterExcludesFetchStatus = Assert<
  Equal<"fetchStatus" extends keyof FetchingFilter ? true : false, false>
>;
type Operations = Assert<
  Equal<
    keyof typeof queryEffects,
    | "query"
    | "infiniteQuery"
    | "prefetch"
    | "prefetchInfinite"
    | "streamSnapshot"
    | "getData"
    | "setData"
    | "getState"
    | "isFetching"
    | "invalidate"
    | "refetch"
    | "cancel"
    | "remove"
    | "reset"
  >
>;
