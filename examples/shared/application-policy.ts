import { exampleRpcGroup } from "@effect-api-query/contracts";
import type { QueryClient } from "@tanstack/query-core";
import {
  configureUtils,
  createRpcQueryUtils,
  defineRpcPolicy,
} from "@ueberbrot/effect-api-query";
import type { RpcClient, RpcGroup } from "effect/rpc";

export const applicationPolicy = defineRpcPolicy(
  exampleRpcGroup,
  {
    query: { retry: false },
    paths: {
      users: {
        query: { staleTime: 30_000 },
      },
      "users.get": { query: { staleTime: 60_000 } },
    },
  },
  { keyPrefix: ["policy-app"] }
);

export const applicationQueries = (
  client: RpcClient.RpcClient<RpcGroup.Rpcs<typeof exampleRpcGroup>>,
  queryClient: QueryClient,
  notifyCreated: (name: string, requestedName: string) => void
) => {
  const base = createRpcQueryUtils(exampleRpcGroup, {
    client,
    keyPrefix: ["policy-app"],
  });
  const configured = configureUtils(base, applicationPolicy);
  const create = configureUtils(configured.users.create, {
    mutation: {
      callbacks: "compose",
      onSuccess: async (user) => {
        queryClient.setQueryData(
          base.users.get.queryKey({
            input: { id: user.id, locale: user.locale },
          }),
          user
        );
        await queryClient.invalidateQueries({
          queryKey: base.users.list.key(),
        });
      },
    },
  });
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
