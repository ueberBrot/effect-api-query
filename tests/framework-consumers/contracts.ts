import {
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  type InferInput,
  type InferQueryError,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/http-api";
import { Rpc, RpcClient, RpcGroup } from "effect/rpc";

export type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
export type Assert<Value extends true> = Value;

const User = Schema.Struct({ id: Schema.Int, name: Schema.String });
const NotFound = Schema.TaggedStruct("NotFound", { id: Schema.Int });
export type User = typeof User.Type;
export const seed: User = { id: 1, name: "Ada" };

const group = RpcGroup.make(
  Rpc.make("users.read", {
    payload: { id: Schema.Int },
    success: User,
    error: NotFound,
  }),
  Rpc.make("users.write", { payload: User, success: User, error: NotFound }),
  Rpc.make("users.watch", {
    payload: { id: Schema.Int },
    success: User,
    error: NotFound,
    stream: true,
  })
);
declare const rpcClient: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
export const rawRpc = createRpcQueryUtils(group, {
  client: rpcClient,
  keyPrefix: ["framework-rpc"],
});
export const rpc = configureUtils(rawRpc, {
  query: { policy: { retry: false } },
  streamed: { policy: { maxChunks: 20 } },
  scoped: {
    users: {
      scoped: {
        read: {
          query: {
            interceptors: [async ({ next }) => await next()],
          },
        },
      },
    },
  },
});

const api = HttpApi.make("framework").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("read", "/users/:id", {
      params: { id: Schema.Int },
      success: User,
      error: NotFound,
    }),
    HttpApiEndpoint.post("write", "/users", {
      payload: User,
      success: User,
      error: NotFound,
    })
  )
);
declare const httpClient: HttpApiClient.ForApi<typeof api>;
export const rawHttp = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ["framework-http"],
});
export const http = configureUtils(rawHttp, {
  query: { policy: { retry: false } },
});

export type RpcError = InferQueryError<typeof rpc.users.read>;
export type HttpError = InferQueryError<typeof http.users.read>;
true satisfies Assert<
  Equal<InferInput<typeof rpc.users.read>, { readonly id: number }>
>;
true satisfies Assert<
  Equal<InferInput<typeof http.users.read>["params"], { readonly id: number }>
>;

// @ts-expect-error RPC payload constructors require a numeric id.
rpc.users.read.queryOptions({ input: { id: "1" } });
// @ts-expect-error HTTP inputs preserve the decoded request containers.
http.users.read.queryOptions({ input: { id: 1 } });
