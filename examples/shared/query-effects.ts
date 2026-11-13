import type { QueryClient } from "@tanstack/query-core";
import {
  createQueryFilter,
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

// Supply the same ready client and QueryClient used by the application's providers.
export const directoryEffects = (
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof directory>>,
  queryClient: QueryClient
) => {
  const rpc = createRpcQueryUtils(directory, {
    client,
    keyPrefix: ["directory"],
  });
  const allUsers = createQueryFilter(rpc.users.read, "query");
  const renameFromEvent = Effect.fn("Directory.renameFromEvent")(
    function* renameFromEvent(id: number, name: string) {
      const options = rpc.users.read.queryOptions({
        input: { id },
        select: (user) => user.name,
      });
      // ensure returns the full cached user, even though observers select its name.
      const user = yield* queryEffects.ensure(options);
      yield* queryEffects.setData(options.queryKey, { ...user, name });
      // Domain policy: mark all directory reads stale without starting refetches.
      yield* queryEffects.invalidate({ ...allUsers(), refetchType: "none" });
      return yield* queryEffects.getData(options.queryKey);
    },
    Effect.provideService(QueryClientService, queryClient)
  );
  return { rpc, renameFromEvent };
};
