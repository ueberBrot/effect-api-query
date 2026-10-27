import { QueryClient } from "@tanstack/query-core";
import {
  configureUtils,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  viewPrefix,
} from "@ueberbrot/effect-api-query";
import type {
  InferInput,
  InferMutationData,
  InferMutationError,
  InferQueryData,
  InferQueryError,
  QueryPolicy,
} from "@ueberbrot/effect-api-query";
import type { HttpApiClient } from "effect/http-api";
import type { RpcClient, RpcGroup } from "effect/rpc";

import { exampleRpcGroup } from "../../examples/contracts/src/contracts";
import { exampleHttpApi } from "../../examples/contracts/src/http-api";
declare const client: RpcClient.RpcClient.Flat<
  RpcGroup.Rpcs<typeof exampleRpcGroup>
>;
declare const httpClient: HttpApiClient.ForApi<typeof exampleHttpApi>;
const rpc = createRpcQueryUtils(exampleRpcGroup, {
  client,
  keyPrefix: ["policy-app"],
});
const http = createHttpApiQueryUtils(exampleHttpApi, {
  client: httpClient,
  keyPrefix: ["policy-app"],
});
declare const reportCreationFailure: (
  name: string | undefined,
  error: unknown
) => void;
declare const authorizeCreation: (
  input: InferInput<typeof rpc.users.create>
) => Promise<void>;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 600_000,
      retry: false,
      retryDelay: 250,
    },
    mutations: { retry: false },
  },
});

queryClient.setQueryDefaults(rpc.key(), { staleTime: 60_000 });
queryClient.setQueryDefaults(rpc.users.key(), { retry: 2 });
queryClient.setQueryDefaults(viewPrefix(rpc.users.get, "query"), {
  staleTime: 120_000,
});

queryClient.setQueryDefaults(http.users.key(), { retry: 1 });
queryClient.setQueryDefaults(viewPrefix(http.users.get, "metadata"), {
  staleTime: 5_000,
});

const policy = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: false,
} satisfies QueryPolicy<typeof rpc.users.get>;
const user = configureUtils(rpc.users.get, { query: { policy } });
const selected = user.queryOptions({
  input: { id: 1 },
  select: (value) => value.name,
});
const refreshUser = user.queryOptions({
  input: { id: 1 },
  staleTime: 0,
  retry: false,
});

const configured = configureUtils(rpc, {
  query: { policy: { retry: false } },
  scoped: {
    users: {
      query: { policy: { staleTime: 30_000 } },
      scoped: {
        get: {
          query: {
            policy: {
              staleTime: (query) =>
                query.state.data === undefined ? 0 : 60_000,
            },
          },
        },
      },
    },
  },
});

const createUser = configureUtils(rpc.users.create, {
  mutation: {
    policy: {
      onSuccess: async (created) => {
        queryClient.setQueryData(
          rpc.users.get.queryKey({ id: created.id }),
          created
        );
        await queryClient.invalidateQueries({ queryKey: rpc.users.key() });
      },
    },
  },
});

const creation = createUser.mutationOptions({
  onMutate: (variables) => ({ submittedName: variables.name }),
  onError: (error, _variables, context) => {
    reportCreationFailure(context?.submittedName, error);
  },
});

const composedCreateUser = configureUtils(rpc.users.create, {
  mutation: {
    callbacks: "compose",
    policy: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: rpc.users.key() }),
    },
  },
});

const interceptedCreateUser = configureUtils(rpc.users.create, {
  mutation: {
    interceptors: [
      async ({ input, next }) => {
        await authorizeCreation(input);
        return await next();
      },
    ],
  },
});

const input: InferInput<typeof rpc.users.get> = { id: 1 };
type UserData = InferQueryData<typeof rpc.users.get>;
type HistoryData = InferQueryData<typeof rpc.diagnostics.stream, "streamed">;
type UserError = InferQueryError<typeof rpc.users.get>;

const selectedOptions = rpc.users.get.queryOptions({
  input: { id: 1 },
  select: (value) => value.name,
});
const selectedName = await queryClient.query(selectedOptions);
const cachedUser = queryClient.getQueryData(selectedOptions.queryKey);

type CreateUserInput = InferInput<typeof rpc.users.create>;
type CreatedUser = InferMutationData<typeof rpc.users.create>;
type CreateUserError = InferMutationError<typeof rpc.users.create>;
