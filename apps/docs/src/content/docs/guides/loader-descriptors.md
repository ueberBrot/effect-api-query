---
title: Transfer Loader Selections
description: Rebind a typed query selection to independent server and browser owners.
---

Use `createQueryDescriptor` to transfer a loader's operation, view, and encoded input to the browser. Register the same operation on both sides. Each registration uses its own ready client.

Supply a compatibility identifier and an input codec that runs synchronously without services. Change the identifier if the contract, codec, key encoder, or execution meaning changes. The leaf key identifies the operation. The view identifies what it caches.

## Load and render the selected user

Acquire separate clients before calling `load` and `restore`. The app transfers the JSON result and escapes it for the page. Mount the returned `App` with its browser cache. On teardown, unmount, cancel queries, wait for local cleanup, and release its resources.

```tsx
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
```

Use the transferred selection to avoid reading the route or form again. `bind` checks the descriptor and returns the receiving leaf, view, view prefix, and prepared input. Pass that input to the matching builder and keep retained values unchanged. For an inputless leaf, use a codec from `void` to JSON, such as `null`, and call its inputless builder.

## Encode rich input explicitly

To transfer `{ id: bigint }`, use `Schema.Struct({ id: Schema.BigIntFromString })`. The descriptor stores a decimal string. `bind` reconstructs the bigint. Match the decoded type to `InferInput<typeof leaf>`. Pass constructor input to `capture`; it copies and freezes the encoded JSON.

`capture` prepares the input before and after the codec round trip and compares canonical identity. `bind` checks the same identity on the receiving leaf. Use deterministic, query-stable RPC constructors. Preserve all values that affect execution, even fields your key encoder omits. Equal keys alone cannot verify those fields.

## Supported views and failures

Register a buffered query, HTTP metadata, or an accumulated or live stream. Use native infinite options and an application page mapper for infinite queries. Set the same local policies on both sides to share a cache entry. Callbacks, selection, retention, publication, and recovery stay local. Use an idle, unobserved key for [stream capture](/effect-api-query/guides/stream-snapshots/) and separate [view codecs](/effect-api-query/guides/hydrate-query-views/) for cached data.

`QueryDescriptorError` throws before execution. `Malformed` means the envelope, version, fields, or JSON are invalid. `Incompatible` means the compatibility ID, operation, or view differs. `Input` means the codec or preparation failed. `Identity` means a round trip or receiving encoder changed the key. Errors omit the descriptor and input. On rejection, load a fresh authorized selection.

Use a public input DTO and a safe key encoder. Keep credentials in client middleware. Authorize the request at execution and validate the enclosing cache snapshot before hydration. A descriptor carries only the selection and its input identity.
