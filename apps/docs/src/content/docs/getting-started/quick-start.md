---
title: RPC Quick Start
description: Acquire an RPC client and use generated query and mutation options.
---

[Install the package](/effect-api-query/getting-started/installation/) before starting. The server must serve the `usersRpc` contract at `http://localhost:3000/rpc` with Effect's JSON RPC protocol. The server and browser application must share the same contract.

## Define the shared contract

Place the declaration in `rpc-contract.ts`. Both the server and client import this module.

Shared contract in `rpc-contract.ts`:

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

## Acquire the client and execute requests

The client module acquires a ready flat client, reads a user, and creates a user. It then releases its resources. Replace the URL with your server's RPC endpoint.

Client integration in `client.ts`:

```ts
import { MutationObserver, QueryClient } from "@tanstack/query-core";
import {
  configureUtils,
  createRpcQueryUtils,
  prepareInput,
} from "@ueberbrot/effect-api-query";
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
    RpcClient.make(usersRpc, { flatten: true }).pipe(
      Effect.provide(protocol),
      Scope.provide(scope)
    )
  );
  const rpc = createRpcQueryUtils(usersRpc, {
    client,
    keyPrefix: ["users-app"] as const,
  });

  const user = await queryClient.query(
    rpc.users.get.queryOptions({ input: { id: 1 } })
  );
  console.log(user.name);

  const read = configureUtils(rpc.users.get, {
    query: { policy: { staleTime: 30_000 } },
  });
  const prepared = prepareInput(rpc.users.get, { id: 1 });
  const sameUser = await queryClient.query(
    read.queryOptions({ input: prepared })
  );
  console.log(sameUser.name);

  const createUser = new MutationObserver(
    queryClient,
    rpc.users.create.mutationOptions()
  );
  const created = await createUser.mutate({ name: "Ada" });
  console.log(created.id);
  await queryClient.invalidateQueries({ queryKey: rpc.users.key() });
} finally {
  try {
    await queryClient.cancelQueries();
  } finally {
    queryClient.clear();
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}
```

Dotted tags become nested paths. For example, `users.get` becomes `rpc.users.get`. The factory uses `Effect.runPromiseExit` by default. If execution needs services, supply a signal-aware `runPromiseExit`. Keep the client's Scope and runner alive while you use the utilities.

Query input is the RPC payload's constructor input. The input `{ id: 1 }` works because the constructor supplies `locale: 'en'`. Defaults must be deterministic because key preparation and client execution construct the payload separately. The decoded response is the query data. Each mutation receives its own variables when `mutate` runs.

Your application decides which queries to invalidate. This example refreshes all `users` reads after creation. If a user or tenant identity affects the returned data, include a safe identifier in `keyPrefix`. Keep credentials out of keys. RPC and HTTP keys have separate namespaces.

## Own the captured input

Ordinary options prepare their key synchronously and retain execution input for later requests and retries. Keep that input, including nested arrays, Dates, Maps, and class state, unchanged while the options can run. A frozen key protects cache identity; it does not freeze or deeply clone execution input. Changing retained values can send a different request under the old key. Create new input and rebuild options when values change.

The example configures the read once, then reuses a prepared input with the configured copy. `prepareInput` performs normalization, key encoding, and canonicalization once for repeated builders. It retains the execution values under the same immutability rule. A handle belongs to that leaf and utility-tree owner; configured copies share the owner. Other leaves or independently created trees reject it. Do not serialize handles for hydration or transfer them to a browser owner. Hydrate query data with the appropriate codec, then prepare fresh input on the receiving owner.

Preparation errors throw synchronously from `queryKey`, `queryOptions`, or `prepareInput`, before a request starts. They are key-generation errors rather than failed query executions. A custom key encoder changes identity only; it cannot change execution input or repair an unstable constructor.

Use a **query-stable payload Schema**: its constructor must accept the normalized payload again without changing encoded meaning. Deterministic missing-field defaults, as above, make omitted and explicit `locale: "en"` inputs identify and execute the same read. Time-dependent or random defaults can select different identities on separate builds; materialize those values explicitly when choosing the request.

A constructor that increments `id` on every construction is not query-stable: `{ id: 1 }` can produce a key for `id: 2` and execute `id: 3`. Expose a query-facing RPC with a standard struct payload and perform the domain conversion explicitly inside its handler. Constructor-sensitive operations can still be mutations, whose variables go directly to the ready client for one construction. See [Data Normalization](/effect-api-query/concepts/data-normalization/).

## Keep a browser client alive

This client module finishes each operation before disposing its resources. In an application, acquire the client once before mounting components and release it after unmounting them. Use the [React client setup](/effect-api-query/guides/react-query/#acquire-and-mount-the-client) for a provider, component, and cleanup callback. Its HTTP client setup can be replaced with the RPC acquisition above.

Before disposing clients that serve streams or concurrent mutations, stop their consumers. Wait for queries, local stream cleanup, and accepted mutations to finish before releasing the clients. Follow [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/). For hooks, continue with [React Query](/effect-api-query/guides/react-query/). For method and input contracts, use [RPC Builders](/effect-api-query/reference/generated-builders/).

## Handle failures and live data

Generated execution errors preserve the complete Effect Cause. Use [Errors](/effect-api-query/reference/errors/) to distinguish declared failures from defects and interruption, and choose one retry owner. The optional Effect cache bridge wraps native rejections in `QueryClientOperationError`; inspect its original `cause` without assuming a declared failure payload. Follow [Suspense and Recovery](/effect-api-query/guides/suspense-and-recovery/) for boundary resets and use ordinary abort-aware queries for open streams that need cancellation.

For an SSR stream, capture an exclusive [stream snapshot](/effect-api-query/guides/stream-snapshots/) and await local cleanup before transferring data. Configure live coalescing only for complete snapshots; keep ordered events lossless. [Performance and Bundling](/effect-api-query/reference/performance/) explains measured costs and regression budgets.
