---
title: HTTP Queries and Mutations
description: Fetch and update data through an Effect HttpApi with TanStack Query.
---

Use `createHttpApiQueryUtils` with your HttpApi definition and ready HttpApiClient. The client
keeps its existing base URL, transport, and middleware configuration.

This example assumes your API has a `users` group with `get` and `create` endpoints. The `get`
endpoint declares a decoded numeric `id` in `params`; `create` accepts `{ name: string }` in
`payload`. Replace the application module imports with your own contract and client.

## Create the utilities

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { createHttpApiQueryUtils } from 'effect-api-query'

import { api } from './api.js'
import { client } from './http-client.js'

const queryClient = new QueryClient()
const http = createHttpApiQueryUtils(api, {
  client,
  keyPrefix: ['my-app'],
})
```

This client needs no additional execution services. If your client or its schemas require services,
also supply a `runPromiseExit` backed by your application runtime. Forward the runner's options
so [query cancellation](/effect-rpc-query/guides/cancellation/#cancel-an-http-query) reaches Effect.

## Fetch a user

```ts
const userOptions = http.users.get.queryOptions({
  input: { params: { id: 1 } },
  staleTime: 30_000,
})

const user = await queryClient.query(userOptions)
```

Pass decoded values in the endpoint's declared `params`, `query`, `headers`, and `payload`
containers. For example, a `Schema.FiniteFromString` parameter takes a number; the ready client
encodes it for transport. Include every declared container, even when its fields are optional.
An endpoint without request input uses `queryOptions()`.

React applications can pass `userOptions` directly to `useQuery`. HTTP builders require complete
request input; they do not accept `skipToken`.

## Create a user and refresh the cache

```ts
const createUser = new MutationObserver(
  queryClient,
  http.users.create.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: http.users.key() }),
  }),
)

await createUser.mutate({ payload: { name: 'Ada' } })
```

Mutation variables use the same decoded request shape as query input. Choose the invalidation
prefix for the data your write changes. React applications can pass the same mutation options to
`useMutation`.

Both builders return decoded response data. Successful `undefined` query data becomes `null`;
mutation results retain `undefined`. Inspect execution failures with
[`isEffectHttpApiQueryError`](/effect-rpc-query/guides/handle-failures/#inspect-http-failures).

## Keep cache entries separate

Use generated keys for individual queries or whole branches:

```ts
const key = http.users.get.queryKey({ params: { id: 1 } })
const cachedUser = queryClient.getQueryData(key)
await queryClient.invalidateQueries({ queryKey: http.users.key() })
```

If client middleware changes results by user or tenant, include a safe user or tenant identifier in
`keyPrefix`. Keep credentials out of keys. Use a
[custom encoder](/effect-rpc-query/guides/custom-key-encoders/#http-requests) when request schemas
need encoding services, contain redacted values, or allow multiple payload alternatives.

Retained HTTP endpoints expose ordinary query and mutation builders. Streaming responses and
multipart requests are omitted; see the [HTTP factory reference](/effect-rpc-query/reference/http-factory/)
for supported request formats and the complete builder contract.

When your application or server request ends, cancel its active queries and clear its QueryClient
before disposing client and runtime resources. See
[Client Lifecycle](/effect-rpc-query/concepts/client-lifecycle/#http-clients-and-execution-services).
