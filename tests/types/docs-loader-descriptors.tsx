import {
  dehydrate,
  hydrate,
  QueryClient,
  QueryClientProvider,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  createQueryDescriptor,
  createRpcQueryUtils,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

const input = Schema.Struct({ id: Schema.Int });
const users = RpcGroup.make(
  Rpc.make("read", {
    payload: input,
    success: Schema.Struct({ name: Schema.String }),
  })
);
export type Client = RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof users>>;

const makeSelection = (client: Client) => {
  const rpc = createRpcQueryUtils(users, { client, keyPrefix: ["users"] });
  return createQueryDescriptor(rpc.read, "query", {
    contract: "users/read-v1",
    input,
  });
};

export async function load(client: Client, id: number) {
  const cache = new QueryClient();
  try {
    const selection = makeSelection(client);
    const descriptor = selection.capture({ id });
    const bound = selection.bind(descriptor);
    await cache.query(bound.leaf.queryOptions({ input: bound.input }));
    return JSON.stringify({ descriptor, state: dehydrate(cache) });
  } finally {
    cache.clear();
  }
}

export function restore(client: Client, json: string) {
  const snapshot = JSON.parse(json);
  const selection = makeSelection(client);
  const bound = selection.bind(snapshot.descriptor);
  const cache = new QueryClient();
  hydrate(cache, snapshot.state);
  function User() {
    const { data } = useSuspenseQuery(
      bound.leaf.queryOptions({ input: bound.input, staleTime: 60_000 })
    );
    return <p>{data.name}</p>;
  }
  return {
    cache,
    App: () => (
      <QueryClientProvider client={cache}>
        <User />
      </QueryClientProvider>
    ),
  };
}
