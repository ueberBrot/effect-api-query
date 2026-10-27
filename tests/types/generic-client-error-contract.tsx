import { useQuery } from "@tanstack/react-query";
import {
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  type HttpApiQueryUtils,
  type InferQueryError,
  type RpcQueryUtils,
} from "@ueberbrot/effect-api-query";
import { Schema, type Cause } from "effect";
import type { HttpClientError } from "effect/http";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;
type TransportError = { readonly _tag: "TransportError" };

const group = RpcGroup.make(
  Rpc.make("read", {
    success: Schema.String,
    error: Schema.Literal("missing"),
  }),
  Rpc.make("events.watch", {
    payload: { id: Schema.Int },
    success: Schema.String,
    stream: true,
  }),
  Rpc.make("ticks", { success: Schema.Int, stream: true })
);
type Queries<Error> = RpcQueryUtils<typeof group, readonly ["generic"], Error>;
const Reader = <Error,>({ rpc }: { readonly rpc: Queries<Error> }) => {
  const query = useQuery(rpc.read.queryOptions());
  return <p>{query.data}</p>;
};
declare const client: RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof group>,
  TransportError
>;
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["generic"] });
const configured = configureUtils(rpc, {
  query: { policy: { retry: false } },
  streamed: { policy: { maxChunks: 20 } },
});
configured satisfies typeof rpc;
configured.events satisfies typeof rpc.events;
configured.events.watch satisfies typeof rpc.events.watch;
configured.ticks satisfies typeof rpc.ticks;
const configuredBranch = configureUtils(rpc.events, {
  streamed: { policy: { maxChunks: 20 } },
});
configuredBranch satisfies typeof rpc.events;
const configuredLeaf = configureUtils(rpc.events.watch, {
  streamed: { policy: { maxChunks: 20 } },
});
configuredLeaf satisfies typeof rpc.events.watch;
// @ts-expect-error Raw builders still require a retention choice at each call.
const missingRpcRetention: typeof configuredLeaf = rpc.events.watch;
configuredLeaf.streamedOptions({ input: { id: 1 } });
configureUtils(configuredLeaf, {
  streamed: { policy: { publicationBatchSize: 2 } },
}).streamedOptions({ input: { id: 1 } });
const ordinary = <Reader rpc={rpc} />;
const configuredReader = <Reader rpc={configured} />;

declare const inferRpcError: <Error>(utils: Queries<Error>) => Error;
const rawRpcError = inferRpcError(rpc);
const configuredRpcError = inferRpcError(configured);
true satisfies Assert<Equal<typeof rawRpcError, TransportError>>;
true satisfies Assert<Equal<typeof configuredRpcError, TransportError>>;

const api = HttpApi.make("generic-http").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("read", "/users", {
      success: Schema.String,
      error: Schema.Literal("missing"),
    }),
    HttpApiEndpoint.get("watch", "/users/:id/events", {
      params: { id: Schema.Int },
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
    }),
    HttpApiEndpoint.get("ticks", "/ticks", {
      success: HttpApiSchema.StreamSse({ data: Schema.Int }),
    })
  )
);
type HttpQueries<Client> = HttpApiQueryUtils<
  typeof api,
  readonly ["generic-http"],
  Client
>;
const HttpReader = <Client,>({
  http,
}: {
  readonly http: HttpQueries<Client>;
}) => {
  const query = useQuery(http.users.read.queryOptions());
  return <p>{query.data}</p>;
};
declare const httpClient: HttpApiClient.ForApi<typeof api, TransportError>;
const http = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ["generic-http"],
});
const configuredHttp = configureUtils(http, {
  streamed: { policy: { maxChunks: 20 } },
});
configuredHttp satisfies typeof http;
configuredHttp.users satisfies typeof http.users;
configuredHttp.users.watch satisfies typeof http.users.watch;
configuredHttp.users.ticks satisfies typeof http.users.ticks;
const configuredHttpBranch = configureUtils(http.users, {
  streamed: { policy: { maxChunks: 20 } },
});
configuredHttpBranch satisfies typeof http.users;
const configuredHttpLeaf = configureUtils(http.users.watch, {
  streamed: { policy: { maxChunks: 20 } },
});
configuredHttpLeaf satisfies typeof http.users.watch;
// @ts-expect-error Raw builders still require a retention choice at each call.
const missingHttpRetention: typeof configuredHttpLeaf = http.users.watch;
configuredHttpLeaf.streamedOptions({ input: { params: { id: 1 } } });
configureUtils(configuredHttpLeaf, {
  streamed: { policy: { publicationBatchSize: 2 } },
}).streamedOptions({ input: { params: { id: 1 } } });
const ordinaryHttpReader = <HttpReader http={http} />;
const configuredHttpReader = <HttpReader http={configuredHttp} />;

declare const inferHttpClient: <Client>(utils: HttpQueries<Client>) => Client;
declare const inferHttpError: <Client>(
  utils: HttpQueries<Client>
) => InferQueryError<HttpQueries<Client>["users"]["read"]>;
const rawHttpClient = inferHttpClient(http);
const configuredHttpClient = inferHttpClient(configuredHttp);
const rawHttpError = inferHttpError(http);
const configuredHttpError = inferHttpError(configuredHttp);
true satisfies Assert<Equal<typeof rawHttpClient, typeof httpClient>>;
true satisfies Assert<Equal<typeof configuredHttpClient, typeof httpClient>>;
true satisfies Assert<
  Equal<typeof rawHttpError, InferQueryError<typeof http.users.read>>
>;
true satisfies Assert<
  Equal<typeof configuredHttpError, InferQueryError<typeof http.users.read>>
>;
true satisfies Assert<
  Equal<
    typeof configuredHttpError.cause,
    Cause.Cause<
      | TransportError
      | "missing"
      | HttpClientError.HttpClientError
      | Schema.SchemaError
    >
  >
>;
void [ordinary, configuredReader, ordinaryHttpReader, configuredHttpReader];
