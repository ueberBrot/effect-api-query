# effect-api-query

`effect-api-query` builds typed TanStack Query options and cache keys from Effect RPC and HttpApi contracts. Pass these options to QueryClient or your framework's Query hooks. The contract defines the inputs and results. Your application controls transport, client lifetime, and cache policy.

> [!IMPORTANT]
> This library is in pre stable release. Expect breaking changes.

## Install

Install the package and TanStack Query Core:

```sh
pnpm add @ueberbrot/effect-api-query @tanstack/query-core
```

The package requires one exact Effect 4 release because its RPC and HTTP API modules are unstable. If automatic peer installation is enabled, pnpm installs that version. Existing applications must use the same version. Use TypeScript 5.9 or newer with `strict: true`, ESM, and ES2022 support. See [compatibility and stability](https://ueberbrot.github.io/effect-api-query/getting-started/compatibility-and-stability/).

## RPC

Import the shared contract in both your server and client. Before calling `readUser`, acquire a matching flat RPC client. Keep its Scope alive while you use the client. The [RPC quick start](https://ueberbrot.github.io/effect-api-query/getting-started/quick-start/) shows acquisition and cleanup.

Shared contract in `rpc-contract.ts`:

```ts
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export const usersRpc = RpcGroup.make(
  Rpc.make("users.get", {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  })
);
```

Client integration in `client.ts`:

```ts
import { QueryClient } from "@tanstack/query-core";
import { createRpcQueryUtils } from "@ueberbrot/effect-api-query";
import type { RpcClient, RpcGroup } from "effect/rpc";

import { usersRpc } from "./rpc-contract.ts";

async function readUser(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof usersRpc>>,
  queryClient: QueryClient
) {
  const rpc = createRpcQueryUtils(usersRpc, {
    client,
    keyPrefix: ["users-app"],
  });
  const user = await queryClient.query(
    rpc.users.get.queryOptions({ input: { id: 1 } })
  );
  return user.name;
}
```

Dotted tags become nested utility paths. For example, `users.get` becomes `rpc.users.get`. RPC inputs use the payload Schema's constructor input, including fields that its defaults can supply.

## HTTP

Import the shared HttpApi in both your server and client. Before calling `readUser`, acquire its ready HttpApiClient. Keep its transport resources alive while you use the client. The [HTTP quick start](https://ueberbrot.github.io/effect-api-query/getting-started/http-quick-start/) shows acquisition and cleanup.

Shared contract in `http-contract.ts`:

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

Client integration in `client.ts`:

```ts
import { QueryClient } from "@tanstack/query-core";
import { createHttpApiQueryUtils } from "@ueberbrot/effect-api-query";
import type { HttpApiClient } from "effect/http-api";

import { usersApi } from "./http-contract.ts";

async function readUser(
  client: HttpApiClient.ForApi<typeof usersApi>,
  queryClient: QueryClient
) {
  const http = createHttpApiQueryUtils(usersApi, {
    client,
    keyPrefix: ["users-app"],
  });
  const user = await queryClient.query(
    http.users.get.queryOptions({ input: { params: { id: 1 } } })
  );
  return user.name;
}
```

HTTP inputs use decoded `params`, `query`, `headers`, and `payload` containers. Both examples use the default Effect runner. If execution needs services, provide a signal-aware `runPromiseExit`. Choose a `keyPrefix` that identifies your application and any user or tenant that affects the returned data. Keep credentials out of keys.

## Capabilities

| Contract | Generated operations |
| --- | --- |
| Unary RPC or buffered nonmultipart HTTP | Query, infinite query, mutation |
| Buffered nonmultipart HTTP | Separate view of response status and headers |
| Buffered multipart HTTP | Mutation with explicit `FormData` |
| RPC stream or unambiguous HTTP SSE | Accumulated streamed query, live query |

Use generated keys to read, write, and invalidate cache entries. Queries forward cancellation to Effect. Use `createQueryFilter` for typed partial filters, `withQueryPolicy` and `withMutationPolicy` for shared defaults, and execution interceptors for reusable request behavior. Mutation policies can compose shared and local callbacks. Typed hydration codecs register each view's serialization policy. Stream recovery and publication controls preserve application ownership of transport and resume policy. Your application decides which queries to invalidate after mutations. See [feature support](https://ueberbrot.github.io/effect-api-query/getting-started/feature-support/) for supported contracts and limits.

## Documentation and examples

- [Documentation](https://ueberbrot.github.io/effect-api-query/): queries, mutations, pagination, streaming, policies, and caching.
- [Integrations](https://ueberbrot.github.io/effect-api-query/integrations/): framework setup and client lifetime.
- [Examples](https://ueberbrot.github.io/effect-api-query/examples/): complete Vite React and TanStack Start applications.
- [API reference](https://ueberbrot.github.io/effect-api-query/reference/public-exports/): factories, builders, keys, and errors.

## Agent skill

Install the library usage skill from this repository:

```sh
npx skills add ueberBrot/effect-api-query --full-depth --skill effect-api-query
```

The npm package includes the same skill. After installing the library, run `npx @tanstack/intent@latest install` and enable `@ueberbrot/effect-api-query`, then load it with:

```sh
npx @tanstack/intent@latest load @ueberbrot/effect-api-query#effect-api-query
```

Intent loads the skill from your installed library version. Update a skill installed from GitHub through the Skills CLI.
