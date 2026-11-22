import type { QueryClient } from "@tanstack/query-core";
import {
  createRpcQueryUtils,
  queryEffects,
  QueryClientService,
} from "@ueberbrot/effect-api-query";
import { Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

export const directory = RpcGroup.make(
  Rpc.make("users.read", {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    error: Schema.Literal("missing"),
  })
);

export const directoryEffects = (
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof directory>>,
  queryClient: QueryClient
) => {
  const rpc = createRpcQueryUtils(directory, {
    client,
    keyPrefix: ["directory"],
  });
  const renameFromEvent = Effect.fn("Directory.renameFromEvent")(
    function* renameFromEvent(id: number, name: string) {
      const options = rpc.users.read.queryOptions({
        input: { id },
      });
      const user = yield* queryEffects.query({
        ...options,
        staleTime: "static",
      });
      yield* queryEffects.setData(options.queryKey, { ...user, name });
      yield* queryEffects.invalidate(
        rpc.users.read.queryFilter({ view: "query", refetchType: "none" })
      );
      return yield* queryEffects.getData(options.queryKey);
    },
    Effect.provideService(QueryClientService, queryClient)
  );
  return { rpc, renameFromEvent };
};
