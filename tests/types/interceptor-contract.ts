import type { MutationFunctionContext } from "@tanstack/query-core";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  configureUtils,
  createRpcQueryUtils,
  skipToken,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";
const group = RpcGroup.make(
  Rpc.make("read", {
    payload: { id: Schema.Int },
    success: Schema.Struct({ name: Schema.String }),
  })
);
declare const client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>;
const rpc = createRpcQueryUtils(group, { client, keyPrefix: ["interceptors"] });
const read = configureUtils(rpc.read, {
  query: {
    interceptors: [
      async ({ context, next }) => {
        context.signal satisfies AbortSignal;
        const data = await next();
        data.name satisfies string;
        return data;
      },
    ],
  },
}).queryOptions;
const selected = useQuery(
  read({
    input: { id: 1 },
    select: (data) => data.name,
    initialData: { name: "seed" },
  })
);
selected.data satisfies string;
read({ input: skipToken }).queryFn satisfies typeof skipToken;
const pages = configureUtils(rpc.read, {
  infinite: {
    interceptors: [
      async ({ next }) => {
        const page = await next();
        page.name satisfies string;
        return page;
      },
    ],
  },
}).infiniteOptions;
pages({
  input: (id: number) => ({ id }),
  initialPageParam: 0,
  getNextPageParam: () => undefined,
});
const write = configureUtils(rpc.read, {
  mutation: {
    interceptors: [
      async ({ input, next }) => {
        input.id satisfies number;
        return await next();
      },
    ],
  },
}).mutationOptions;
useMutation(
  write({
    onMutate: (input) => ({ previous: input.id }),
    onSuccess: (data, _input, optimistic) => {
      data.name satisfies string;
      optimistic.previous satisfies number;
    },
  })
);
configureUtils(rpc.read, {
  mutation: {
    policy: { onSuccess: () => undefined },
    callbacks: "compose",
  },
}).mutationOptions({
  onMutate: () => ({ previous: 1 }),
  onSuccess: (_data, _input, optimistic) => {
    optimistic.previous satisfies number;
  },
});
// @ts-expect-error The interceptor must preserve the decoded query function result.
configureUtils(rpc.read, {
  query: {
    interceptors: [async () => 1],
  },
}).queryOptions;
// @ts-expect-error The original builder still requires numeric input.
read({ input: { id: "1" } });
const directWrite = configureUtils(rpc.read, {
  mutation: {
    interceptors: [
      async ({ context, next }) => {
        context satisfies MutationFunctionContext | undefined;
        // @ts-expect-error Direct mutation function calls do not supply native observer context.
        context.client;
        return await next();
      },
    ],
  },
}).mutationOptions;
directWrite().mutationFn({ id: 1 });
