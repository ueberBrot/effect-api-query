# effect-api-query

Derive typed TanStack Query options and cache keys from your Effect RPC and HttpApi contracts.
Pass the generated options to QueryClient or your framework's Query hooks. Inputs and results
follow the contract; your application controls transport, client lifetime, and cache policy.

## Install

Install the package and TanStack Query Core:

```sh
pnpm add effect-api-query @tanstack/query-core
```

The package pins one exact Effect 4 release because its RPC and HTTP API modules are unstable.
With automatic peer installation enabled, pnpm installs that version. Existing applications must
match it. Use TypeScript 5.9 or newer with `strict: true`, ESM, and ES2022 support. See
[compatibility and stability](https://ueberbrot.github.io/effect-api-query/getting-started/compatibility-and-stability/).

## RPC

Import the shared contract from both your server and client. Acquire a matching **flat RPC client**
before calling `readUser`, and keep its Scope alive while the client is in use. The
[RPC quick start](https://ueberbrot.github.io/effect-api-query/getting-started/quick-start/)
shows acquisition and cleanup.

**Shared contract — `rpc-contract.ts`**

```ts
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

export const usersRpc = RpcGroup.make(
  Rpc.make('users.get', {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  }),
)
```

**Client integration — `client.ts`**

```ts
import { QueryClient } from '@tanstack/query-core'
import { createRpcQueryUtils } from 'effect-api-query'
import type { RpcClient, RpcGroup } from 'effect/rpc'

import { usersRpc } from './rpc-contract.ts'

async function readUser(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof usersRpc>>,
  queryClient: QueryClient,
) {
  const rpc = createRpcQueryUtils(usersRpc, { client, keyPrefix: ['users-app'] })
  const user = await queryClient.query(rpc.users.get.queryOptions({ input: { id: 1 } }))
  return user.name
}
```

Dotted tags become nested utility paths: `users.get` becomes `rpc.users.get`. RPC inputs use the
payload Schema's constructor input.

## HTTP

Import the shared HttpApi from both your server and client. Acquire its **ready HttpApiClient**
before calling `readUser`, and keep its transport resources alive while the client is in use. The
[HTTP quick start](https://ueberbrot.github.io/effect-api-query/getting-started/http-quick-start/)
shows acquisition and cleanup.

**Shared contract — `http-contract.ts`**

```ts
import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'

export const usersApi = HttpApi.make('users-api').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    }),
  ),
)
```

**Client integration — `client.ts`**

```ts
import { QueryClient } from '@tanstack/query-core'
import { createHttpApiQueryUtils } from 'effect-api-query'
import type { HttpApiClient } from 'effect/http-api'

import { usersApi } from './http-contract.ts'

async function readUser(client: HttpApiClient.ForApi<typeof usersApi>, queryClient: QueryClient) {
  const http = createHttpApiQueryUtils(usersApi, { client, keyPrefix: ['users-app'] })
  const user = await queryClient.query(
    http.users.get.queryOptions({ input: { params: { id: 1 } } }),
  )
  return user.name
}
```

HTTP inputs use decoded `params`, `query`, `headers`, and `payload` containers. Both examples use
the default Effect runner; provide a signal-aware `runPromiseExit` when execution needs services.
Choose a `keyPrefix` that identifies your application and any user or tenant that affects its data.
Keep credentials out of keys.

## Capabilities

| Contract                                | Generated operations                          |
| --------------------------------------- | --------------------------------------------- |
| Unary RPC or buffered nonmultipart HTTP | Query, infinite query, mutation               |
| Buffered nonmultipart HTTP              | Separate response status/header metadata view |
| Buffered multipart HTTP                 | Mutation with explicit `FormData`             |
| RPC stream or unambiguous HTTP SSE      | Accumulated streamed query, live query        |

Generated keys support cache reads, writes, and invalidation. Queries forward cancellation to
Effect. Use `withQueryPolicy` and `withMutationPolicy` to share typed defaults. Your application
invalidates affected queries after mutations. See
[feature support](https://ueberbrot.github.io/effect-api-query/getting-started/feature-support/)
for supported contracts and limits.

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

The same skill ships in the npm package. With the library installed, run
`npx @tanstack/intent@latest install` and enable `effect-api-query`, then load it with:

```sh
npx @tanstack/intent@latest load effect-api-query#effect-api-query
```

Intent uses the skill from the installed library version. GitHub skill installations update
separately through the Skills CLI.
