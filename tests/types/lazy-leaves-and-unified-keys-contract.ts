import {
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  prepareInput,
  skipToken,
  type InferInput,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  type HttpApiClient,
} from "effect/http-api";
import { Rpc, RpcGroup, type RpcClient } from "effect/rpc";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const rpcGroup = RpcGroup.make(
  Rpc.make("users.get", {
    payload: { id: Schema.Int },
    success: Schema.String,
  }),
  Rpc.make("users.admin.ban", {
    payload: { id: Schema.Int },
    success: Schema.Boolean,
  }),
  Rpc.make("health.ping", {
    success: Schema.Void,
  }),
  Rpc.make("events.watch", {
    payload: { channel: Schema.String },
    success: Schema.String,
    stream: true,
  }),
  Rpc.make("events.audit", {
    success: Schema.String,
    stream: true,
  })
);

declare const rpcClient: RpcClient.RpcClient<RpcGroup.Rpcs<typeof rpcGroup>>;
const rpc = createRpcQueryUtils(rpcGroup, { client: rpcClient });

const preparedRpcUser = prepareInput(rpc.users.get, { id: 1 });
const preparedRpcWatch = prepareInput(rpc.events.watch, { channel: "ch" });

rpc.users.get.queryKey({ input: { id: 1 } });
rpc.users.get.queryKey({ input: preparedRpcUser });
rpc.users.get.infiniteKey({ input: { id: 1 } });
rpc.users.get.infiniteKey({ input: preparedRpcUser });
rpc.events.watch.liveKey({ input: { channel: "ch" } });
rpc.events.watch.liveKey({ input: preparedRpcWatch, coalesceMs: 50 });
rpc.events.watch.streamedKey({ input: { channel: "ch" }, maxChunks: 10 });
rpc.events.watch.streamedKey({
  input: preparedRpcWatch,
  maxChunks: "unbounded",
  refetchMode: "append",
});

rpc.health.ping.queryKey();
rpc.health.ping.infiniteKey();
rpc.events.audit.liveKey();
rpc.events.audit.liveKey({ coalesceMs: 10 });
rpc.events.audit.streamedKey({ maxChunks: 5 });
rpc.users.get.key();
rpc.users.get.mutationKey();

true satisfies Assert<
  Equal<InferInput<typeof rpc.users.get>, { readonly id: number }>
>;
true satisfies Assert<Equal<InferInput<typeof rpc.health.ping>, void>>;

// @ts-expect-error Positional queryKey calls are rejected.
rpc.users.get.queryKey({ id: 1 });
// @ts-expect-error Positional infiniteKey calls are rejected.
rpc.users.get.infiniteKey({ id: 1 });
// @ts-expect-error Positional liveKey calls are rejected.
rpc.events.watch.liveKey({ channel: "ch" });
// @ts-expect-error Positional streamedKey calls are rejected.
rpc.events.watch.streamedKey({ channel: "ch" }, { maxChunks: 5 });
// @ts-expect-error skipToken is rejected on queryKey.
rpc.users.get.queryKey({ input: skipToken });
// @ts-expect-error skipToken is rejected on infiniteKey.
rpc.users.get.infiniteKey({ input: skipToken });
// @ts-expect-error skipToken is rejected on liveKey.
rpc.events.watch.liveKey({ input: skipToken });
// @ts-expect-error skipToken is rejected on streamedKey.
rpc.events.watch.streamedKey({ input: skipToken, maxChunks: 5 });
// @ts-expect-error Unconfigured streamedKey still requires maxChunks.
rpc.events.watch.streamedKey({ input: { channel: "ch" } });
// @ts-expect-error Inputless unconfigured streamedKey still requires maxChunks.
rpc.events.audit.streamedKey();

const configuredRpc = configureUtils(rpc, {
  streamed: { maxChunks: 20 },
});
configuredRpc.events.watch.streamedKey({ input: { channel: "ch" } });
configuredRpc.events.watch.streamedKey({
  input: preparedRpcWatch,
  refetchMode: "replace",
});
configuredRpc.events.audit.streamedKey();
configuredRpc.events.audit.streamedKey({ refetchMode: "append" });
// @ts-expect-error Configured input-bearing streamedKey still requires input.
configuredRpc.events.watch.streamedKey();
// @ts-expect-error Configured input-bearing streamedKey still requires input.
configuredRpc.events.watch.streamedKey({ refetchMode: "append" });

const httpApi = HttpApi.make("unifiedHttp")
  .add(
    HttpApiGroup.make("items")
      .add(
        HttpApiEndpoint.get("get", "/items/:id", {
          params: { id: Schema.String },
          success: Schema.String,
        })
      )
      .add(
        HttpApiEndpoint.get("list", "/items", {
          success: Schema.Array(Schema.String),
        })
      )
      .add(
        HttpApiEndpoint.get("stream", "/items/:id/stream", {
          params: { id: Schema.String },
          success: HttpApiSchema.StreamSse({ data: Schema.String }),
        })
      )
      .add(
        HttpApiEndpoint.get("globalStream", "/items/stream", {
          success: HttpApiSchema.StreamSse({ data: Schema.String }),
        })
      )
  )
  .add(
    HttpApiGroup.make("health", { topLevel: true }).add(
      HttpApiEndpoint.get("ping", "/ping", {
        success: Schema.String,
      })
    )
  );

declare const httpClient: HttpApiClient.ForApi<typeof httpApi>;
const http = createHttpApiQueryUtils(httpApi, { client: httpClient });

const preparedHttpGet = prepareInput(http.items.get, { params: { id: "1" } });
const preparedHttpStream = prepareInput(http.items.stream, {
  params: { id: "1" },
});

http.items.get.queryKey({ input: { params: { id: "1" } } });
http.items.get.queryKey({ input: preparedHttpGet });
http.items.get.metadataKey({ input: { params: { id: "1" } } });
http.items.get.metadataKey({ input: preparedHttpGet });
http.items.get.infiniteKey({ input: { params: { id: "1" } } });
http.items.get.infiniteKey({ input: preparedHttpGet });
http.items.stream.liveKey({ input: { params: { id: "1" } } });
http.items.stream.liveKey({ input: preparedHttpStream, coalesceMs: 20 });
http.items.stream.streamedKey({
  input: { params: { id: "1" } },
  maxChunks: 10,
});
http.items.stream.streamedKey({
  input: preparedHttpStream,
  maxChunks: "unbounded",
});

http.items.list.queryKey();
http.items.list.metadataKey();
http.items.list.infiniteKey();
http.items.globalStream.liveKey();
http.items.globalStream.liveKey({ coalesceMs: 10 });
http.items.globalStream.streamedKey({ maxChunks: 5 });
http.ping.queryKey();
http.ping.metadataKey();

// @ts-expect-error Positional HTTP queryKey calls are rejected.
http.items.get.queryKey({ params: { id: "1" } });
// @ts-expect-error Positional HTTP metadataKey calls are rejected.
http.items.get.metadataKey({ params: { id: "1" } });
// @ts-expect-error Positional HTTP infiniteKey calls are rejected.
http.items.get.infiniteKey({ params: { id: "1" } });
// @ts-expect-error Positional HTTP liveKey calls are rejected.
http.items.stream.liveKey({ params: { id: "1" } });
// @ts-expect-error Positional HTTP streamedKey calls are rejected.
http.items.stream.streamedKey({ params: { id: "1" } }, { maxChunks: 5 });
// @ts-expect-error skipToken is rejected on HTTP queryKey.
http.items.get.queryKey({ input: skipToken });
// @ts-expect-error skipToken is rejected on HTTP metadataKey.
http.items.get.metadataKey({ input: skipToken });
// @ts-expect-error Unconfigured HTTP streamedKey requires maxChunks.
http.items.stream.streamedKey({ input: { params: { id: "1" } } });

const configuredHttp = configureUtils(http, {
  streamed: { maxChunks: 15 },
});
configuredHttp.items.stream.streamedKey({ input: { params: { id: "1" } } });
configuredHttp.items.globalStream.streamedKey();
// @ts-expect-error Configured HTTP input-bearing streamedKey still requires input.
configuredHttp.items.stream.streamedKey();

type SymbolKeys<T> = Extract<keyof T, symbol>;
type PhantomPaths<T> = NonNullable<T[SymbolKeys<T>]>;

type ExpectedRpcRootPaths =
  | "users"
  | "users.get"
  | "users.admin"
  | "users.admin.ban"
  | "health"
  | "health.ping"
  | "events"
  | "events.watch"
  | "events.audit";
type ExpectedRpcUsersPaths = "get" | "admin" | "admin.ban";
type ExpectedHttpRootPaths =
  | "items"
  | "items.get"
  | "items.list"
  | "items.stream"
  | "items.globalStream"
  | "ping";
type ExpectedHttpItemsPaths = "get" | "list" | "stream" | "globalStream";

true satisfies Assert<
  Equal<Extract<PhantomPaths<typeof rpc>, string>, ExpectedRpcRootPaths>
>;
true satisfies Assert<
  Equal<Extract<PhantomPaths<typeof rpc.users>, string>, ExpectedRpcUsersPaths>
>;
true satisfies Assert<
  Equal<
    Extract<PhantomPaths<typeof configuredRpc>, string>,
    ExpectedRpcRootPaths
  >
>;
true satisfies Assert<
  Equal<Extract<PhantomPaths<typeof http>, string>, ExpectedHttpRootPaths>
>;
true satisfies Assert<
  Equal<
    Extract<PhantomPaths<typeof http.items>, string>,
    ExpectedHttpItemsPaths
  >
>;
true satisfies Assert<
  Equal<
    Extract<PhantomPaths<typeof configuredHttp>, string>,
    ExpectedHttpRootPaths
  >
>;
