import { exampleRpcGroup } from "@effect-api-query/contracts";
import type { QueryClient } from "@tanstack/query-core";
import {
  configureUtils,
  createRpcQueryUtils,
  defineUtilsPolicy,
} from "@ueberbrot/effect-api-query";
import type { RpcQueryUtils } from "@ueberbrot/effect-api-query";
import type { RpcClient, RpcGroup } from "effect/rpc";

type ApplicationUtils = RpcQueryUtils<
  typeof exampleRpcGroup,
  readonly ["policy-app"]
>;

export const applicationPolicy = defineUtilsPolicy<ApplicationUtils>()({
  query: { policy: { retry: false } },
  scoped: {
    users: {
      query: { policy: { staleTime: 30_000 } },
      scoped: {
        get: { query: { policy: { staleTime: 60_000 } } },
      },
    },
  },
});

export const applicationQueries = (
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof exampleRpcGroup>>,
  queryClient: QueryClient,
  notifyCreated: (name: string, requestedName: string) => void
) => {
  const base = createRpcQueryUtils(exampleRpcGroup, {
    client,
    keyPrefix: ["policy-app"],
  });
  const writes = defineUtilsPolicy<ApplicationUtils["users"]["create"]>()({
    mutation: {
      callbacks: "compose",
      policy: {
        onSuccess: async (user) => {
          queryClient.setQueryData(
            base.users.get.queryKey({ id: user.id, locale: user.locale }),
            user
          );
          await queryClient.invalidateQueries({
            queryKey: base.users.list.key(),
          });
        },
      },
    },
  });
  const configured = configureUtils(base, applicationPolicy);
  const create = configureUtils(configured.users.create, writes);
  return {
    rpc: configured,
    selectedUser: (id: number) =>
      configured.users.get.queryOptions({
        input: { id },
        staleTime: 5000,
        select: (user) => user.name,
      }),
    pages: configured.users.page.infiniteOptions({
      initialPageParam: 0,
      input: (cursor) => ({ cursor, pageSize: 10 }),
      getNextPageParam: (page) => page.nextCursor,
    }),
    createUser: create.mutationOptions({
      onMutate: (input) => ({ requestedName: input.name }),
      onSuccess: (user, _input, optimistic) => {
        notifyCreated(user.name, optimistic.requestedName);
      },
    }),
  };
};
