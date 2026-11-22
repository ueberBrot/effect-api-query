# RPC setup and rules

Use the app's RPC group and protocol. The example needs a server at `http://localhost:3000/rpc` that implements the same contract. It reads a user, renames it, and closes the Scope.

```ts
import { MutationObserver, QueryClient } from "@tanstack/query-core";
import { createRpcQueryUtils } from "@ueberbrot/effect-api-query";
import { Effect, Exit, Layer, Schema, Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from "effect/rpc";

const users = RpcGroup.make(
  Rpc.make("users.get", {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  }),
  Rpc.make("users.rename", {
    payload: { id: Schema.Int, name: Schema.String },
    success: Schema.Void,
  })
);

const protocol = RpcClient.layerProtocolHttp({
  url: "http://localhost:3000/rpc",
}).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer)
);
const scope = await Effect.runPromise(Scope.make());
const queryClient = new QueryClient();

try {
  const client = await Effect.runPromise(
    RpcClient.make(users).pipe(Effect.provide(protocol), Scope.provide(scope))
  );
  const rpc = createRpcQueryUtils(users, { client });
  const input = { id: 1 };
  await queryClient.query(
    rpc.users.get.queryOptions({ input, staleTime: 30_000 })
  );
  const cached = queryClient.getQueryData(rpc.users.get.queryKey({ input }));
  console.log(cached?.name);

  const rename = new MutationObserver(
    queryClient,
    rpc.users.rename.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(rpc.users.queryFilter());
      },
    })
  );
  await rename.mutate({ id: 1, name: "Ada" });
} finally {
  try {
    await queryClient.cancelQueries();
  } finally {
    queryClient.clear();
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}
```

## Tree and payload semantics

Acquire a tag-keyed client with `RpcClient.make(group)`. You can also use an existing flat client. Factories validate paths and object-client methods up front and build each frozen leaf on first access. Dotted tags become nested paths, so `users.get` becomes `rpc.users.get`. Use brackets for a segment with a hyphen. The factory rejects colliding paths and reserved names.

Pass payload constructor input. Preparation applies Schema defaults before it builds the key. If the locale defaults to `'en'`, omitted and explicit English values match the same query. The client constructs the normalized payload again during execution. Use a query-stable Schema so both constructions have the same encoded meaning.

Keep retained execution input and nested values unchanged. The library freezes the encoded key. Rebuild options with new values when the input changes. Supply time-dependent or random values explicitly.

If a constructor increments `id`, input 1 can build a key for 2 and send a request for 3. Move the conversion to the handler of an RPC with a stable struct input. A key encoder or prepared input leaves client construction unchanged.

Preparation errors throw synchronously, including from `prepareInput`. `PayloadConstructionFailed` identifies the RPC constructor. Schema encoding, custom encoding, and invalid JSON have separate key error codes. Execution errors arrive later as failed Exits.

Pass raw constructor input to a mutation. The client constructs it once at execution. A mutation key identifies the operation and skips variable encoding. Constructor-sensitive Schemas can still serve mutations.

## Request-local options

Set local `headers` or `context` through `rpcOptions`. Streams also accept `streamBufferSize`. Each options object fixes these values for retries and pages. The builder strips them from Query options and leaves them out of the key.

If a header changes the result, include a safe identity in the payload or prefix. Set `streamBufferSize` for the client queue and `maxChunks` for cached history. Use the ready client's normal result or stream form. Leave out `discard` and `asQueue`.

## Custom key encoders

Use the original literal tag as the key, for example `'secrets.read'`. The encoder receives the payload after defaults. Supply one if encoding needs services, contains redacted values, or uses opaque middleware. The runtime applies this rule even for synchronous, service-free middleware.

Return a strict `JsonValue` synchronously. Use finite numbers, strings, booleans, null, dense arrays, and plain objects with defined values. Encode or project dates and bytes first. Undefined entries, cycles, and unsafe property names fail.

Preserve every difference that changes a result. Use safe identifiers for secrets. The ready client still uses the original input and its required services.

See [RPC builders](https://ueberbrot.github.io/effect-api-query/reference/generated-builders/).

Reuse the tree within one owner. Factories can reuse declaration analysis, but each tree binds its own client, runner, prefix, and encoders.
