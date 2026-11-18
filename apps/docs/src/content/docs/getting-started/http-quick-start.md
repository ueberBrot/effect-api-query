---
title: HTTP Quick Start
description: Run a typed HTTP API query with an Effect client and TanStack Query.
---

Fetch user 1 and print the name. [Install the package](/effect-api-query/getting-started/installation/) first. The example needs a server that implements `usersApi` at `http://localhost:3000`. The server must have a user with ID 1.

If you want to try the library with a server included, [run a complete example](/effect-api-query/examples/).

## Share the contract

Save the contract as `http-contract.ts`. Import it in both your server and client.

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

## Fetch a user

Save this code as `client.ts`. If your server uses another address, change the base URL.

```ts
import { QueryClient } from "@tanstack/query-core";
import { createHttpApiQueryUtils } from "@ueberbrot/effect-api-query";
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
} finally {
  try {
    await queryClient.cancelQueries();
  } finally {
    queryClient.clear();
    await runtime.dispose();
  }
}
```

Run `client.ts` with your project's TypeScript runner. It prints the user's name.

The group and endpoint become `http.users.get`. Supply the declared `params` and `query` objects. Pass the locale explicitly because HTTP builders use decoded request input. The QueryClient caches the decoded user.

Use a `keyPrefix` that includes a safe user or tenant identifier if the response depends on that identity. Keep credentials out of the key. [Cache keys and filters](/effect-api-query/guides/cache-filters/) shows how to target cached results.

## Keep the client alive

The script closes the runtime after one query. In an app, keep it open while requests use it. See [client lifecycle](/effect-api-query/concepts/client-lifecycle/) for stopping streams and waiting for mutations before shutdown.

Use the same options with [your framework](/effect-api-query/integrations/), or try a [mutation](/effect-api-query/guides/mutations/). If you reuse inputs or define Schema defaults, see [input handling](/effect-api-query/concepts/data-normalization/).
