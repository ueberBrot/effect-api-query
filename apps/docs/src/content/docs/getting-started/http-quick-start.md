---
title: HTTP Quick Start
description: Acquire an HttpApiClient and use generated query and mutation options.
---

[Install the package](/effect-api-query/getting-started/installation/) before starting. The server must serve the `usersApi` contract at `http://localhost:3000`. The server and browser application must share the same contract.

## Define the shared contract

Place the declaration in `http-contract.ts`. Both the server and client import this module.

Shared contract in `http-contract.ts`:

```ts
import { Effect, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

const User = Schema.Struct({ id: Schema.Int, name: Schema.String });
export const usersApi = HttpApi.make("users-api").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("get", "/users/:id", {
      params: { id: Schema.Int },
      query: {
        locale: Schema.String.pipe(
          Schema.withConstructorDefault(Effect.succeed("en"))
        ),
      },
      success: User,
    }),
    HttpApiEndpoint.post("create", "/users", {
      payload: Schema.Struct({ name: Schema.String }),
      success: User,
    })
  )
);
```

## Acquire the client and execute requests

The client module uses a ManagedRuntime to acquire the ready client. It reads a user, creates a user, and then releases its resources. Replace the base URL with your server's URL.

Client integration in `client.ts`:

```ts
import { MutationObserver, QueryClient } from "@tanstack/query-core";
import {
  configureUtils,
  createHttpApiQueryUtils,
  prepareInput,
} from "@ueberbrot/effect-api-query";
import { ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { usersApi } from "./http-contract.ts";

const runtime = ManagedRuntime.make(FetchHttpClient.layer);
const queryClient = new QueryClient();

try {
  const client = await runtime.runPromise(
    HttpApiClient.make(usersApi, { baseUrl: "http://localhost:3000" })
  );
  const http = createHttpApiQueryUtils(usersApi, {
    client,
    keyPrefix: ["users-app"] as const,
    runPromiseExit: runtime.runPromiseExit,
  });

  const user = await queryClient.query(
    http.users.get.queryOptions({
      input: { params: { id: 1 }, query: { locale: "en" } },
    })
  );
  console.log(user.name);

  const read = configureUtils(http.users.get, {
    query: { policy: { staleTime: 30_000 } },
  });
  const prepared = prepareInput(http.users.get, {
    params: { id: 1 },
    query: { locale: "en" },
  });
  const sameUser = await queryClient.query(
    read.queryOptions({ input: prepared })
  );
  console.log(sameUser.name);

  const createUser = new MutationObserver(
    queryClient,
    http.users.create.mutationOptions()
  );
  const created = await createUser.mutate({ payload: { name: "Ada" } });
  console.log(created.id);
  await queryClient.invalidateQueries({ queryKey: http.users.key() });
} finally {
  try {
    await queryClient.cancelQueries();
  } finally {
    queryClient.clear();
    await runtime.dispose();
  }
}
```

HTTP input is the decoded request. Supply the endpoint's declared `params`, `query`, `headers`, and `payload` containers. The client encodes those values for transport. HTTP builders do not apply Schema constructor defaults. This request supplies `locale: 'en'` explicitly.

The runtime provides the HTTP transport and forwards TanStack's signal through `runPromiseExit`. Keep the runtime and client resources alive while queries and mutations use them. Your application decides which queries to invalidate. This example refreshes the `users` endpoint prefix after creation.

Buffered nonmultipart endpoints provide query and mutation builders for every HTTP method. Buffered multipart endpoints provide mutations only. Literal group and endpoint names become utility paths. Use bracket access for names that contain dots. With `topLevel: true`, endpoints appear at the root. See [HTTP Factory](/effect-api-query/reference/http-factory/).

## Own the captured input

Ordinary options prepare their key synchronously and retain execution input for later requests and retries. Keep that input, including nested arrays, Dates, Maps, and class state, unchanged while the options can run. A frozen key protects cache identity; it does not freeze or deeply clone execution input. Changing retained values can send a different request under the old key. Create new input and rebuild options when values change.

The example configures the read once, then reuses a prepared input with the configured copy. `prepareInput` performs normalization, key encoding, and canonicalization once for repeated builders. It retains the execution values under the same immutability rule. A handle belongs to that leaf and utility-tree owner; configured copies share the owner. Other leaves or independently created trees reject it. Do not serialize handles for hydration or transfer them to a browser owner. Hydrate query data with the appropriate codec, then prepare fresh input on the receiving owner.

Preparation errors throw synchronously from `queryKey`, `queryOptions`, or `prepareInput`, before a request starts. They are key-generation errors rather than failed query executions. A custom key encoder changes identity only; it cannot change execution input or repair an unstable constructor.

HTTP takes **decoded request input**, not RPC payload constructor input. Constructor defaults in an HTTP declaration do not fill missing request fields here. Supply `locale: "en"` explicitly, as both ordinary and prepared examples do. The ready client separately encodes the retained decoded containers for transport. The RPC query-stable payload constructor requirement concerns RPC reconstruction; HTTP requires unchanged decoded input and deterministic identity encoding.

## Keep a browser client alive

This client module awaits its mutation before disposal. If you use components, acquire the client once before mounting them. Keep the client alive for the application lifetime. Follow [React client setup](/effect-api-query/guides/react-query/#acquire-and-mount-the-client) for a complete provider, component, and cleanup callback.

For streams or concurrent writes, follow [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) before disposal. Continue with [pagination](/effect-api-query/guides/pagination/), [streaming](/effect-api-query/guides/streaming/), or [HTTP metadata](/effect-api-query/guides/http-metadata/). For request containers and file uploads, use [HTTP Requests and Uploads](/effect-api-query/guides/http-queries-and-mutations/).
