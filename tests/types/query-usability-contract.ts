import { QueryClient } from "@tanstack/query-core";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  configureUtils,
  consumeEvents,
  createBranchQueryFilter,
  createHttpApiQueryUtils,
  createRpcQueryUtils,
  findDeclaredError,
  prepareInput,
  skipToken,
} from "@ueberbrot/effect-api-query";
import type { InferInput, InferQueryError } from "@ueberbrot/effect-api-query";
import { Effect, Option, Schema, Stream } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";
const group = RpcGroup.make(
  Rpc.make("read", {
    payload: { id: Schema.Int },
    success: Schema.Int,
    error: Schema.TaggedStruct("Missing", { id: Schema.Int }),
  }),
  Rpc.make("watch", {
    payload: { id: Schema.Int },
    success: Schema.Int,
    stream: true,
  })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["usability"] });
const queryClient = new QueryClient();
const leaf = configureUtils(rpc.read, {
  query: {
    policy: { staleTime: 1000 },
    interceptors: [
      async ({ next }) => {
        const data: number = await next();
        return data;
      },
    ],
  },
  mutation: {
    policy: {
      onSuccess: (data, input) => {
        const result: number = data + input.id;
        void result;
      },
    },
    callbacks: "compose",
  },
});
const prepared = prepareInput(leaf, { id: 1 });
const query = useQuery(
  leaf.queryOptions({
    input: prepared,
    initialData: 1,
    select: (value) => String(value),
  })
);
const selected: string = query.data;
const cached: number | undefined = queryClient.getQueryData(
  leaf.queryKey(prepared)
);
const plain: InferInput<typeof rpc.watch> = { id: 1 };
const skipped = leaf.queryOptions({
  input: Math.random() > 0.5 ? prepared : skipToken,
});
useQuery(skipped);
useMutation(
  leaf.mutationOptions({
    onMutate: (input) => ({ previous: input.id }),
    onError: (_error, _input, context) => {
      const previous: number | undefined = context?.previous;
      void previous;
    },
  })
);
// @ts-expect-error A prepared input is not a mutation payload.
leaf.mutationOptions().mutationFn(prepared);
// @ts-expect-error Preparation checks the original input shape.
prepareInput(rpc.read, { id: "wrong" });
rpc.read.infiniteOptions({
  // @ts-expect-error Infinite mappers construct each page from raw input.
  input: () => prepared,
  initialPageParam: 0,
  getNextPageParam: () => undefined,
});
// @ts-expect-error A live stream has no publication batching policy.
rpc.watch.liveOptions({ input: plain, publicationMaxWaitMs: 10 });
rpc.watch.streamedOptions({
  maxChunks: "unbounded",
  input: prepareInput(rpc.watch, plain),
  publicationBatchSize: 10,
  publicationMaxWaitMs: 50,
});
// @ts-expect-error Read leaves have no live view.
configureUtils(rpc.read, {
  live: {},
});
// @ts-expect-error Policies cannot replace generated identity.
configureUtils(rpc.read, {
  query: { policy: { queryKey: [] } },
});
const projectedPolicy = {
  staleTime: 100,
  select: (value: number) => String(value),
};
configureUtils(rpc.read, {
  // @ts-expect-error Variable-supplied projections must remain local to preserve result types.
  query: { policy: projectedPolicy },
});
const optimisticPolicy = { retry: false, onMutate: () => ({ previous: 1 }) };
configureUtils(rpc.read, {
  // @ts-expect-error Variable-supplied optimistic context must remain local to the mutation.
  mutation: { policy: optimisticPolicy },
});
queryClient.invalidateQueries(createBranchQueryFilter(rpc, "query")());
declare const failure: InferQueryError<typeof rpc.read>;
const found = findDeclaredError(failure, "Missing");
if (Option.isSome(found)) {
  const id: number = found.value.id;
  void id;
}
// @ts-expect-error Only tags in the typed failure union are accepted.
findDeclaredError(failure, "Other");
const api = HttpApi.make("usability").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("read", "/users/:id", {
      params: { id: Schema.Int },
      success: Schema.Int,
    })
  )
);
declare const httpClient: HttpApiClient.ForApi<typeof api>;
const http = createHttpApiQueryUtils(api, {
  client: httpClient,
  keyPrefix: ["usability"],
});
const request = prepareInput(http.users.read, { params: { id: 1 } });
const metadata = useQuery(
  configureUtils(http.users.read, {
    metadata: {
      policy: { staleTime: 1000 },
    },
  }).metadataOptions({ input: request, select: (value) => value.data })
);
const data: number | undefined = metadata.data;
const consumed: Effect.Effect<void, "handler"> = consumeEvents(
  Stream.make(1, 2),
  {
    onEvent: (event) =>
      event > 1 ? Effect.fail("handler" as const) : Effect.void,
  }
);
void [selected, cached, data, consumed];
