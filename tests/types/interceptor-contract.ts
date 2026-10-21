import type { MutationFunctionContext } from "@tanstack/query-core";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createRpcQueryUtils,
  skipToken,
  withMutationInterceptor,
  withMutationPolicy,
  withQueryInterceptor,
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
const read = withQueryInterceptor(
  rpc.read,
  "query",
  async ({ context, next }) => {
    context.signal satisfies AbortSignal;
    const data = await next();
    data.name satisfies string;
    return data;
  }
);
const selected = useQuery(
  read({
    input: { id: 1 },
    select: (data) => data.name,
    initialData: { name: "seed" },
  })
);
selected.data satisfies string;
read({ input: skipToken }).queryFn satisfies typeof skipToken;
const pages = withQueryInterceptor(rpc.read, "infinite", async ({ next }) => {
  const page = await next();
  page.name satisfies string;
  return page;
});
pages({
  input: (id: number) => ({ id }),
  initialPageParam: 0,
  getNextPageParam: () => undefined,
});
const write = withMutationInterceptor(rpc.read, async ({ input, next }) => {
  input.id satisfies number;
  return await next();
});
useMutation(
  write({
    onMutate: (input) => ({ previous: input.id }),
    onSuccess: (data, _input, optimistic) => {
      data.name satisfies string;
      optimistic.previous satisfies number;
    },
  })
);
withMutationPolicy(
  rpc.read,
  { onSuccess: () => undefined },
  { callbacks: "compose" }
)({
  onMutate: () => ({ previous: 1 }),
  onSuccess: (_data, _input, optimistic) => {
    optimistic.previous satisfies number;
  },
});
// @ts-expect-error The interceptor must preserve the decoded query function result.
withQueryInterceptor(rpc.read, "query", async () => 1);
// @ts-expect-error The original builder still requires numeric input.
read({ input: { id: "1" } });

const directWrite = withMutationInterceptor(
  rpc.read,
  async ({ context, next }) => {
    context satisfies MutationFunctionContext | undefined;
    // @ts-expect-error Direct mutation function calls do not supply native observer context.
    context.client;
    return await next();
  }
);
directWrite().mutationFn({ id: 1 });
