import { QueryCache } from "@tanstack/query-core";
import type { QueryKey } from "@tanstack/query-core";
import {
  createQueryFilter,
  createRpcQueryUtils,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

const group = RpcGroup.make(
  Rpc.make("read", { payload: { id: Schema.Int }, success: Schema.String }),
  Rpc.make("watch", { success: Schema.String, stream: true })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["filters"] });
const byId = createQueryFilter(rpc.read, "query", (id: number) => ({ id }));
byId(1, {
  stale: true,
  predicate: (query) => query.state.status === "success",
});
createQueryFilter(rpc.watch, "streamed")({ fetchStatus: "fetching" });
// @ts-expect-error The projection determines the filter input.
byId("1");
// @ts-expect-error Generated filters retain their own key identity.
byId(1, { queryKey: ["other"] });
// @ts-expect-error Unary leaves have no live representation.
createQueryFilter(rpc.read, "live");
// @ts-expect-error Streaming leaves have no ordinary query view.
createQueryFilter(rpc.watch, "query");
// @ts-expect-error Projections must return strict JSON types.
createQueryFilter(rpc.read, "query", (id: number) => ({ id: BigInt(id) }));

const contextual = createQueryFilter(rpc.read, "query", ({ id }) => {
  id satisfies number;
  // @ts-expect-error Contextual filter input retains the leaf's numeric field.
  id satisfies string;
  return { id };
});
const filter = contextual({ id: 1 });
filter.queryKey satisfies QueryKey;
const cache = new QueryCache();
cache.find({ ...filter, exact: false });
cache.find(createQueryFilter(rpc.read, "query")());
