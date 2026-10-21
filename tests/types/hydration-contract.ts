import {
  defaultShouldDehydrateQuery,
  dehydrate,
  hydrate,
} from "@tanstack/query-core";
import type { DehydratedState, QueryClient } from "@tanstack/query-core";
import {
  createHttpApiQueryUtils,
  createHydrationRegistry,
  createRpcQueryUtils,
  hydrationCallbacks,
  infiniteQueryCodec,
  queryViewCodec,
} from "@ueberbrot/effect-api-query";
import type {
  HydrationCodec,
  HydrationRegistry,
} from "@ueberbrot/effect-api-query";
import { Context, Effect, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

import { Profile } from "./docs-hydration-rich.ts";
import { Cursor, HistoryElement } from "./docs-hydration-views.ts";

const group = RpcGroup.make(
  Rpc.make("read", { payload: { id: Schema.Int }, success: Profile }),
  Rpc.make("optional", { success: Schema.UndefinedOr(Profile) }),
  Rpc.make("watch", {
    success: Schema.UndefinedOr(Schema.NullOr(Profile)),
    stream: true,
  })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["codec-types"] });
const ordinary = queryViewCodec(rpc.read, "query", Profile);
const pages = infiniteQueryCodec(rpc.read, {
  page: Profile,
  pageParam: Cursor,
});
queryViewCodec(rpc.optional, "query", Schema.NullOr(Profile));
queryViewCodec(rpc.watch, "live", Schema.NullOr(Profile));
queryViewCodec(rpc.watch, "streamed", Schema.Array(HistoryElement));
hydrationCallbacks(ordinary);
hydrationCallbacks(pages);

const viewRegistry = createHydrationRegistry([
  queryViewCodec(rpc.read, "query", Profile),
  infiniteQueryCodec(rpc.read, { page: Profile, pageParam: Cursor }),
  queryViewCodec(rpc.watch, "streamed", Schema.Array(HistoryElement)),
  queryViewCodec(rpc.watch, "live", Schema.NullOr(Profile)),
]);

const prepareRegisteredSnapshot = Effect.fnUntraced(function* (
  queryClient: QueryClient
) {
  const snapshot = dehydrate(queryClient, {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) &&
      viewRegistry.matches(query.queryKey),
  });
  const queries = yield* viewRegistry.encodeQueries(snapshot.queries);
  return JSON.stringify({ ...snapshot, queries });
});

const hydrateRegisteredSnapshot = Effect.fnUntraced(function* (
  queryClient: QueryClient,
  json: string
) {
  const snapshot: DehydratedState = JSON.parse(json);
  const queries = yield* viewRegistry.decodeQueries(snapshot.queries);
  hydrate(queryClient, { ...snapshot, queries });
});

// @ts-expect-error Branches have no supported cached view.
queryViewCodec(rpc, "query", Profile);
// @ts-expect-error Unary RPCs have no metadata view.
queryViewCodec(rpc.read, "metadata", Profile);
// @ts-expect-error Stream leaves have no ordinary query view.
queryViewCodec(rpc.watch, "query", Profile);
// @ts-expect-error A codec validates cache data, not a select projection.
queryViewCodec(rpc.read, "query", Schema.String);
// @ts-expect-error Query data normalizes undefined to null.
queryViewCodec(rpc.optional, "query", Schema.UndefinedOr(Profile));
// @ts-expect-error The codec must include every supported cached success.
queryViewCodec(rpc.optional, "query", Profile);
// @ts-expect-error Infinite registration always requires an explicit page-parameter codec.
infiniteQueryCodec(rpc.read, { page: Profile });
// @ts-expect-error Infinite pages must match the leaf's query data.
infiniteQueryCodec(rpc.read, { page: Schema.String, pageParam: Cursor });
// @ts-expect-error Streams cannot register infinite codecs.
infiniteQueryCodec(rpc.watch, { page: Profile, pageParam: Cursor });
// @ts-expect-error Infinite views use the explicit page/pageParam registration helper.
queryViewCodec(rpc.read, "infinite", Profile);

const api = HttpApi.make("codec-types").add(
  HttpApiGroup.make("profiles").add(
    HttpApiEndpoint.get("read", "/profile", { success: Profile })
  )
);
declare const httpClient: HttpApiClient.ForApi<typeof api>;
const http = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ["codec-types"],
});
queryViewCodec(
  http.profiles.read,
  "metadata",
  Schema.Struct({
    data: Profile,
    status: Schema.Finite,
    headers: Schema.Record(Schema.String, Schema.String),
  })
);
// @ts-expect-error The metadata view includes status and raw headers.
queryViewCodec(http.profiles.read, "metadata", Profile);

class Encoding extends Context.Service<
  Encoding,
  { readonly prepare: Effect.Effect<void> }
>()("CodecEncoding") {}
class Decoding extends Context.Service<
  Decoding,
  { readonly prepare: Effect.Effect<void> }
>()("CodecDecoding") {}
const Prepared = Profile.pipe(
  Schema.middlewareEncoding<typeof Profile, Encoding>((encoding) =>
    Encoding.pipe(
      Effect.flatMap(({ prepare }) => prepare.pipe(Effect.andThen(encoding)))
    )
  ),
  Schema.middlewareDecoding((decoding) =>
    Decoding.pipe(
      Effect.flatMap(({ prepare }) => prepare.pipe(Effect.andThen(decoding)))
    )
  )
);
const effectful = queryViewCodec(rpc.read, "query", Prepared);
const serviceCodec: HydrationCodec<
  Profile,
  typeof Profile.Encoded,
  Decoding,
  Encoding
> = effectful;
const registry = createHydrationRegistry([effectful, pages]);
const serviceRegistry: HydrationRegistry<Decoding, Encoding> = registry;
const exactServices: typeof registry = serviceRegistry;
// @ts-expect-error Service-dependent codecs cannot provide synchronous native callbacks.
hydrationCallbacks(effectful);
type Assert<Value extends true> = Value;
type Equal<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
const encoding = registry.encodeQueries([]);
const decoding = registry.decodeQueries([]);
const wrongService = encoding.pipe(
  Effect.provideService(Decoding, { prepare: Effect.void })
);
type EncodingContext = Assert<
  Equal<Effect.Services<typeof encoding>, Encoding>
>;
type DecodingContext = Assert<
  Equal<Effect.Services<typeof decoding>, Decoding>
>;
type WrongServiceContext = Assert<
  Equal<Effect.Services<typeof wrongService>, Encoding>
>;
Effect.runPromise(
  registry
    .encodeQueries([])
    .pipe(Effect.provideService(Encoding, { prepare: Effect.void }))
);
Effect.runPromise(
  registry
    .decodeQueries([])
    .pipe(Effect.provideService(Decoding, { prepare: Effect.void }))
);

void serviceCodec;
void exactServices;
