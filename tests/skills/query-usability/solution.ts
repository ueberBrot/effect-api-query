import {
  configureQuery,
  createBranchQueryFilter,
} from "@ueberbrot/effect-api-query";

import type { DashboardClient, DashboardRpc } from "./fixture";

export const dashboard = (
  rpc: DashboardRpc,
  client: DashboardClient,
  audit: (value: number) => void
) => ({
  read: configureQuery(rpc.users.read, "query", {
    policy: { staleTime: 1000 },
    interceptors: [
      async ({ next: execute }) => {
        const value = await execute();
        audit(value);
        return value;
      },
    ],
  }),
  refresh: async () => {
    await client.invalidateQueries(
      createBranchQueryFilter(rpc.users, "query")()
    );
  },
  watch: rpc.users.watch.streamedOptions({
    publicationBatchSize: 10,
    publicationMaxWaitMs: 50,
  }),
});
