import { QueryClient } from "@tanstack/query-core";
import {
  configureUtils,
  createRpcQueryUtils,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";
const group = RpcGroup.make(
  Rpc.make("watch", {
    payload: { id: Schema.String },
    success: Schema.Void,
    stream: true,
  })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["live"] });
const options = rpc.watch.liveOptions({
  input: { id: "a" },
  coalesceMs: 25,
  select: (value) => value === null,
});
const cache = new QueryClient();
const value: null | undefined = cache.getQueryData(options.queryKey);
const configured = configureUtils(rpc, {
  live: { policy: { coalesceMs: 25 } },
});
configured.watch.liveKey({ id: "a" }, { coalesceMs: undefined });
// @ts-expect-error Live deadlines are numeric.
rpc.watch.liveOptions({ input: { id: "a" }, coalesceMs: "25" });
// @ts-expect-error Live queries do not accumulate batches.
rpc.watch.liveOptions({ input: { id: "a" }, publicationBatchSize: 2 });
// @ts-expect-error Accumulated streams do not discard intermediate events.
rpc.watch.streamedOptions({ input: { id: "a" }, maxChunks: 5, coalesceMs: 25 });
void value;
