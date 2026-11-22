---
title: React Query
description: Acquire a ready client and use generated options with native React Query hooks.
---

Pass the generated options to React Query hooks. Create the utilities once for the Effect client and QueryClient. Build options in the component so they pick up new input on render.

See [compatibility](/effect-api-query/reference/compatibility-and-limits/#requirements-and-tested-integrations) for React requirements and tested versions.

## Acquire and mount the client

Install React, React DOM, `@tanstack/react-query`, Effect, and `effect-api-query`. This example needs a server that implements the contract below. `GET /users/:id` returns an object with `id` and `name`.

### Shared contract

Save `usersApi` in `http-contract.ts` and import it on the server and client.

```ts
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export const usersApi = HttpApi.make("users-api").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("get", "/users/:id", {
      params: { id: Schema.Int },
      success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    })
  )
);
```

### Client lifetime

Save the client setup in `client.ts`. `startUsersApplication` acquires the HTTP client and keeps the runtime and QueryClient open until `dispose` runs.

```ts
import {
  acquireQueryOwner,
  createHttpApiQueryUtils,
} from "@ueberbrot/effect-api-query";
import { ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { usersApi } from "./http-contract.ts";

export const startUsersApplication = async (baseUrl: string) => {
  const owner = await acquireQueryOwner(
    async (setup) => {
      const runtime = await setup.acquire(
        () => ManagedRuntime.make(FetchHttpClient.layer),
        async (acquired) => acquired.dispose()
      );
      const client = await runtime.runPromise(
        HttpApiClient.make(usersApi, { baseUrl })
      );
      return setup.trackUtils(
        createHttpApiQueryUtils(usersApi, { client, runtime })
      );
    },
    { defaultOptions: { queries: { retry: false } } }
  );
  return owner;
};

export type UsersApplication = Awaited<
  ReturnType<typeof startUsersApplication>
>;
```

This example uses the optional `acquireQueryOwner` helper. Register resources it must close with `setup.acquire`. Use `setup.borrow(client)` for resources your app closes itself. If acquisition fails, the helper releases previously acquired resources in reverse order. Call `setup.trackUtils` once so disposal waits for client execution, query finalizers, and accepted generated mutation functions. See [owner retirement](/effect-api-query/guides/switch-cache-owners/#opt-in-owner-helper) before adding writes.

### Component and provider

In `users-app.tsx`, create a typed context with `createQueryUtilsContext` from the optional React subpath. Pass the query owner to its provider. It supplies both the utility tree and the owner’s QueryClient.

```tsx
import { useQuery } from "@tanstack/react-query";
import { createQueryUtilsContext } from "@ueberbrot/effect-api-query/react";
import { createRoot } from "react-dom/client";

import { startUsersApplication } from "./client.ts";
import type { UsersApplication } from "./client.ts";

const { Provider, useQueryUtils } =
  createQueryUtilsContext<UsersApplication["resources"]>();

const User = () => {
  const http = useQueryUtils();
  const user = useQuery(
    http.users.get.queryOptions({ input: { params: { id: 1 } } })
  );
  if (user.isPending) {
    return <p>Loading user…</p>;
  }
  if (user.isError) {
    return <p role="alert">Could not load the user.</p>;
  }
  return <h1>{user.data.name}</h1>;
};

export const mountUsersApplication = async (
  element: HTMLElement,
  baseUrl: string
) => {
  const application = await startUsersApplication(baseUrl);
  const root = createRoot(element);
  root.render(
    <Provider owner={application}>
      <User />
    </Provider>
  );
  return async () => {
    root.unmount();
    await application.dispose();
  };
};
```

If you only need the owner and cache, use `QueryOwnerProvider` with `useQueryOwner`. When a host such as TanStack Start provides the cache, set `provideQueryClient={false}`.

The provider remounts its QueryClient subtree when the client changes, so observers attach to the new cache. Your app calls `dispose()` on retirement. React Strict Mode and Activity can clean up effects without retiring the owner.

### Application entry point

In `main.tsx`, mount the app in the root element from your HTML. Set the base URL to your server.

```ts
import { mountUsersApplication } from "./users-app.tsx";

const element = document.getElementById("root");
if (element === null) {
  throw new Error("Missing application root element");
}

export const stopUsers = await mountUsersApplication(
  element,
  "http://localhost:3000"
);
```

On teardown, call and await `stopUsers()`. It unmounts React, cancels reads, waits for local finalizers, clears the cache, and disposes of the runtime. A page unload can end before asynchronous cleanup finishes.

See [client lifecycle](/effect-api-query/concepts/client-lifecycle/) before adding open streams or concurrent writes. For RPC, use the [RPC quick start](/effect-api-query/getting-started/quick-start/) to acquire the client and pass its utilities to the same pattern.

## Choose the native hook

Use these hooks with either adapter. RPC takes [payload constructor input](/effect-api-query/concepts/data-normalization/#query-stable-rpc-payloads). HTTP takes [decoded request input](/effect-api-query/concepts/data-normalization/#decoded-http-inputs).

| Native consumer | Generated options | Cached representation |
| --- | --- | --- |
| `useQuery` | `queryOptions`, HTTP `metadataOptions` | Decoded data, or decoded data with status and headers |
| `useInfiniteQuery` | `infiniteOptions` | Pages with their page parameters |
| `useQuery` | `streamedOptions`, `liveOptions` | Retained history, or the latest emitted value |
| `useMutation` | `mutationOptions` | Mutation result, with variables supplied when `mutate` runs |

Pass native options such as `select`, `staleTime`, and `retry` through the builder. `select` changes what the hook returns while the cache keeps the full query value. Set hashing on QueryClient. See [RPC builders](/effect-api-query/reference/generated-builders/) and [HTTP builders](/effect-api-query/reference/http-builders/) for keys and functions.

## Share policy and refresh affected reads

To reuse endpoint-aware defaults across components and loaders, set [shared policies](/effect-api-query/guides/query-defaults/). Local projections and callbacks retain native inference.

Pass generated options to `useMutation` and supply variables through `mutate`. Choose which reads to mark stale with [cache keys and filters](/effect-api-query/guides/cache-filters/). See [optimistic updates](/effect-api-query/guides/optimistic-writes/) to seed a result or roll back a local change.

## Streams and Suspense

Ordinary hooks show stream data while fetching continues. Set [history retention](/effect-api-query/guides/choose-stream-history/) and wait for local stream finalizers before releasing clients.

Use ordinary hooks when the screen needs cancellation. For buffered reads with Suspense, see [reset boundaries, handle failed refetches, and start reads together](/effect-api-query/guides/suspense-and-recovery/).

For loaders and server rendering, see [Router and Start](/effect-api-query/guides/tanstack-start/). To try a complete client app, [run the Vite React example](/effect-api-query/examples/#run-vite-react).

## Handle failures and retries

Inspect declared failures, defects, and interruption in the [Effect Cause](/effect-api-query/guides/handle-failures/). Choose [one retry layer](/effect-api-query/guides/retry-queries/) to keep attempt counts predictable.
