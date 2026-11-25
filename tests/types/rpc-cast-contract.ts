import {
  createRpcQueryUtils,
  type CreateRpcQueryUtilsOptions,
  type EffectRpcQueryError,
  type InferInput,
  type InferMutationData,
  type InferQueryData,
  type InferQueryError,
  type RpcQueryUtils,
  type RunPromiseExit,
  type RuntimeInput,
} from "@ueberbrot/effect-api-query";
import { Context, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

class EncodingService extends Context.Service<
  EncodingService,
  { readonly locale: string }
>()("rpc-cast-contract/EncodingService") {}

const payload = Schema.Struct({
  id: Schema.Int,
  locale: Schema.String.pipe(
    Schema.withConstructorDefault(Effect.succeed("en"))
  ),
});
const servicePayload = payload.pipe(
  Schema.middlewareEncoding<typeof payload, EncodingService>((encoding) =>
    Effect.flatMap(EncodingService, () => encoding)
  )
);

class Group extends RpcGroup.make(
  Rpc.make("records.read", {
    payload: servicePayload,
    success: Schema.UndefinedOr(Schema.Int),
    error: Schema.Literal("missing"),
  }),
  Rpc.make("records.watch", {
    payload: { id: Schema.String },
    success: Schema.UndefinedOr(Schema.String),
    error: Schema.Literal("stream-failed"),
    stream: true,
  }),
  Rpc.make("health.ping")
) {}

declare const client: RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof Group>,
  "transport-failed"
>;
declare const runner: RunPromiseExit<EncodingService>;
const utils = createRpcQueryUtils(Group, {
  client,
  keyPrefix: ["cast-audit", 1],
  keyEncoders: {
    "records.read": (input) => {
      input.locale satisfies string;
      return { id: input.id, locale: input.locale };
    },
  },
  runtime: runner,
});

utils.records.read.queryOptions({ input: { id: 1 } });
utils.records.watch.liveOptions({ input: { id: "record" } });
utils.records.watch.streamedOptions({
  maxChunks: "unbounded",
  input: { id: "record" },
  rpcOptions: { streamBufferSize: 2 },
});
utils.health.ping.queryOptions();

true satisfies Assert<
  Equal<
    typeof utils,
    RpcQueryUtils<typeof Group, readonly ["cast-audit", 1], "transport-failed">
  >
>;
true satisfies Assert<
  Equal<
    InferInput<typeof utils.records.read>,
    { readonly id: number; readonly locale?: string }
  >
>;
true satisfies Assert<
  Equal<InferQueryData<typeof utils.records.read>, number | null>
>;
true satisfies Assert<
  Equal<InferMutationData<typeof utils.records.read>, number | undefined>
>;
true satisfies Assert<
  Equal<
    InferQueryError<typeof utils.records.read>,
    EffectRpcQueryError<"missing" | "transport-failed">
  >
>;
true satisfies Assert<
  Equal<
    InferQueryData<typeof utils.records.watch, "streamed">,
    readonly (string | undefined)[]
  >
>;
true satisfies Assert<
  Equal<InferQueryData<typeof utils.records.watch, "live">, string | null>
>;
utils.health.ping.queryKey() satisfies readonly [
  `effect-api-query:v2:${string}`,
  "rpc",
  "health",
  "ping",
  null,
  "query",
];
true satisfies Assert<
  Equal<
    CreateRpcQueryUtilsOptions<
      typeof Group,
      readonly ["cast-audit"],
      "transport-failed"
    >["runtime"],
    RuntimeInput<EncodingService>
  >
>;

class IsolatedErrorsGroup extends RpcGroup.make(
  Rpc.make("alpha", {
    success: Schema.String,
    error: Schema.Literal("only-a"),
  }),
  Rpc.make("beta", {
    success: Schema.String,
    error: Schema.Literal("only-b"),
  })
) {}

declare const standardObjectClient: RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof IsolatedErrorsGroup>
>;
declare const transportObjectClient: RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof IsolatedErrorsGroup>,
  "transport-failed"
>;
declare const subtypedObjectClient: RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof IsolatedErrorsGroup>
> & { readonly marker?: true };
declare const customObjectClient: Pick<
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof IsolatedErrorsGroup>, "extra-a">,
  "alpha"
> &
  Pick<RpcClient.RpcClient<RpcGroup.Rpcs<typeof IsolatedErrorsGroup>>, "beta">;

const unprefixedObjectUtils = createRpcQueryUtils(IsolatedErrorsGroup, {
  client: standardObjectClient,
});
const prefixedObjectUtils = createRpcQueryUtils(IsolatedErrorsGroup, {
  client: standardObjectClient,
  keyPrefix: ["isolated"],
});
const subtypedObjectUtils = createRpcQueryUtils(IsolatedErrorsGroup, {
  client: subtypedObjectClient,
  keyPrefix: ["isolated-subtyped"],
});
const transportObjectUtils = createRpcQueryUtils(IsolatedErrorsGroup, {
  client: transportObjectClient,
  keyPrefix: ["isolated-transport"],
});
const customObjectUtils = createRpcQueryUtils(IsolatedErrorsGroup, {
  client: customObjectClient,
  keyPrefix: ["isolated-custom"],
});

true satisfies Assert<
  Equal<
    InferQueryError<typeof unprefixedObjectUtils.alpha>,
    EffectRpcQueryError<"only-a">
  >
>;
true satisfies Assert<
  Equal<
    InferQueryError<typeof prefixedObjectUtils.alpha>,
    EffectRpcQueryError<"only-a">
  >
>;
true satisfies Assert<
  Equal<
    InferQueryError<typeof subtypedObjectUtils.alpha>,
    EffectRpcQueryError<"only-a">
  >
>;
true satisfies Assert<
  Equal<
    InferQueryError<typeof transportObjectUtils.alpha>,
    EffectRpcQueryError<"only-a" | "transport-failed">
  >
>;
true satisfies Assert<
  Equal<
    InferQueryError<typeof customObjectUtils.alpha>,
    EffectRpcQueryError<"only-a" | "extra-a">
  >
>;
true satisfies Assert<
  Equal<
    InferQueryError<typeof customObjectUtils.beta>,
    EffectRpcQueryError<"only-b" | "extra-a">
  >
>;
