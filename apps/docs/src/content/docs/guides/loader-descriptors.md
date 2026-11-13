---
title: Transfer Loader Selections
description: Rebind a typed query selection to independent server and browser owners.
---

A loader descriptor records one generated operation, view, and encoded input. It carries no query data or ready client. Register the same operation on the server and browser with `createQueryDescriptor`. Each registration binds to its own ready-client owner.

The application supplies a compatibility identifier and a synchronous, service-free input codec. Change the identifier when the contract, codec, custom key encoder, or execution meaning changes. The full generated leaf key, including the application prefix and adapter namespace, identifies the operation. The view identifies its cache representation.

## Load and render the selected user

Acquire independent ready clients before calling `load` and `restore`. Keep each client's Scope and runtime alive while its queries run. The following module uses a JSON-safe result; the application owns JSON transport and script escaping. On the browser, mount the returned `App` and keep its cache for that owner. On teardown, unmount, cancel outstanding queries, await local cleanup, and dispose the client resources.

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
export const users = RpcGroup.make(
  Rpc.make("read", {
    payload: input,
    success: Schema.Struct({ name: Schema.String }),
  })
);
type Client = RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof users>>;

export const makeSelection = (client: Client) => {
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

The browser uses the transferred input rather than reading a route or mutable form again. `bind` validates the descriptor and returns the receiving leaf, literal view, view prefix, and a fresh owner-bound prepared input. Pass that input to the matching native builder. Keep retained rich values immutable. Inputless registrations use a codec from `void` to a JSON value, such as `null`, and use their native inputless builders.

## Encode rich input explicitly

For a decoded input `{ id: bigint }`, use `Schema.Struct({ id: Schema.BigIntFromString })` as the input codec. The descriptor carries a decimal string and `bind` reconstructs the bigint. Other rich values need equally explicit codecs. The codec's decoded type must match `InferInput<typeof leaf>`. `capture` accepts constructor input, never a prepared-input token. It copies and freezes the encoded JSON so later changes to the original object cannot change the selection.

`capture` prepares the original input and its codec round trip and checks canonical identity. `bind` decodes and prepares again on the receiving leaf and checks that identity. RPC payloads must remain query-stable under reconstruction; defaults must be deterministic. This does not make constructor-sensitive queries safe. A codec must preserve all execution-relevant decoded state, including state omitted by a custom key encoder. Equal keys alone cannot prove that property.

## Supported views and failures

Register buffered RPC/HTTP queries, HTTP metadata, accumulated or live streams. Native options retain their original inference and behavior. Stream retention, publication policy and recovery stay local. Infinite views are excluded: use native infinite options and an application-owned page mapper instead. Configure equivalent policies on both owners when sharing a cache entry. A descriptor does not transport callbacks or select projections. For streams, pass rebuilt options to `fetchStreamSnapshot` on an exclusive idle, unobserved key; descriptors do not relax capture or cleanup requirements. For rich cached data, use the separate [query-view hydration codecs](/effect-api-query/guides/hydrate-query-views/) before application serialization and native hydration.

Failures throw `QueryDescriptorError` synchronously, before query execution. `Malformed` rejects invalid envelopes, extra envelope fields, unsupported versions and non-JSON values. `Incompatible` rejects a different compatibility identifier, operation prefix or view. `Input` rejects codec or input-preparation failure. `Identity` rejects a codec round trip or receiving encoder that changes canonical input identity. Error objects retain no descriptor or input. Handle rejection by loading a fresh authorized selection rather than hydrating an incompatible entry.

Descriptors carry no query results, clients, functions, credentials, or prepared tokens. Choose a public input DTO and safe custom key encoder when necessary; the library cannot identify arbitrary sensitive application fields. Keep authentication in the ready client's application-owned middleware. Neither the descriptor nor its identity is an authorization token, signature, schema fingerprint, or protection against hostile input. Validate authorization at execution. Validate the enclosing cache snapshot separately before hydration.
