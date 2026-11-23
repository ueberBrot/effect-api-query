---
title: RPC Quick Start
description: Run a typed RPC query with an Effect client and TanStack Query.
---

Fetch user 1 and print the name. [Install the package](/effect-api-query/getting-started/installation/) first. The example needs a server that implements `usersRpc` at `http://localhost:3000/rpc` with the Effect JSON RPC protocol. The server must have a user with ID 1.

If you want to try the library with a server included, [run a complete example](/effect-api-query/examples/).

## Share the contract

Save the contract as `rpc-contract.ts`. Import it in both your server and client.

```ts
import { Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

const User = Schema.Struct({ id: Schema.Int, name: Schema.String });
export const usersRpc = RpcGroup.make(
  Rpc.make("users.get", {
    payload: {
      id: Schema.Int,
      locale: Schema.String.pipe(
        Schema.withConstructorDefault(Effect.succeed("en"))
      ),
    },
    success: User,
  }),
  Rpc.make("users.create", {
    payload: { name: Schema.String },
    success: User,
  })
);
```

## Fetch a user

Save this code as `client.ts`. If your server uses another address, change the RPC endpoint.

```ts
import { QueryClient } from "@tanstack/query-core";
import { createRpcQueryUtils } from "@ueberbrot/effect-api-query";
import { Effect, Exit, Layer, Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { usersRpc } from "./rpc-contract.ts";

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
    RpcClient.make(usersRpc).pipe(
      Effect.provide(protocol),
      Scope.provide(scope)
    )
  );
  const rpc = createRpcQueryUtils(usersRpc, { client });

  const user = await queryClient.query(
    rpc.users.get.queryOptions({ input: { id: 1 } })
  );
  console.log(user.name);
} finally {
  try {
    await queryClient.cancelQueries();
  } finally {
    queryClient.clear();
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}
```

Run `client.ts` with your project's TypeScript runner. It prints the user's name.

The tag `users.get` becomes `rpc.users.get`. The payload Schema supplies the default locale for `{ id: 1 }`. The QueryClient caches the decoded user.

Use a `keyPrefix` that includes a safe user or tenant identifier if the response depends on that identity. Keep credentials out of the key. [Cache keys and filters](/effect-api-query/guides/cache-filters/) shows how to target cached results.

## Keep the client alive

The script closes the Scope after one query. In an app, keep it open while requests use the RPC client. See [client lifecycle](/effect-api-query/concepts/client-lifecycle/) for stopping streams and waiting for mutations before shutdown.

Use the same options with [your framework](/effect-api-query/integrations/), or try a [mutation](/effect-api-query/guides/mutations/). If you reuse inputs or define Schema defaults, see [input handling](/effect-api-query/concepts/data-normalization/).
