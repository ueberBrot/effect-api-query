import {
  createRpcQueryUtils,
  type InferQueryData,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

const group = RpcGroup.make(
  Rpc.make("read", { success: Schema.Int }),
  Rpc.make("watch", { success: Schema.Int, stream: true })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const rpc = createRpcQueryUtils(group, {
  client,
  keyPrefix: ["explicit-retention"],
});

rpc.read.queryOptions();
rpc.read.queryOptions(undefined);
rpc.read.queryOptions({});
rpc.watch.liveOptions();
rpc.watch.liveOptions(undefined);
rpc.watch.liveOptions({});
rpc.watch.streamedOptions({ maxChunks: 20 });
rpc.watch.streamedOptions({ maxChunks: "unbounded" });
rpc.watch.streamedOptions({ maxChunks: 20, initialData: [1] });
const options = rpc.watch.streamedOptions({
  maxChunks: 20,
  select: (values) => values.length,
});
const length: number | undefined = options.select?.([1, 2]);
const history: InferQueryData<typeof rpc.watch, "streamed"> = [1, 2];

// @ts-expect-error Accumulated queries require an explicit retention choice.
rpc.watch.streamedOptions();
// @ts-expect-error Undefined options cannot supply retention.
rpc.watch.streamedOptions(undefined);
// @ts-expect-error An options object must include retention.
rpc.watch.streamedOptions({});
// @ts-expect-error Initial data does not select a retention policy.
rpc.watch.streamedOptions({ initialData: [1] });
void [length, history];
