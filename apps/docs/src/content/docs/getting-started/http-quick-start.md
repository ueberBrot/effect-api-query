---
title: HTTP Quick Start
description: Acquire an HttpApiClient and use generated query and mutation options.
---

First [install the package](/effect-api-query/getting-started/installation/). The server must
serve the same `usersApi` contract at `http://localhost:3000`. Share the contract between your
server and browser application.

## Acquire the client and execute requests

This complete module defines the API, acquires the ready client through a ManagedRuntime,
reads a user, writes a user, and releases its resources. Replace the base URL with your server.

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, ManagedRuntime, Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import { FetchHttpClient } from 'effect/http'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'

const User = Schema.Struct({ id: Schema.Int, name: Schema.String })
const usersApi = HttpApi.make('users-api').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      query: {
        locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))),
      },
      success: User,
    }),
    HttpApiEndpoint.post('create', '/users', {
      payload: Schema.Struct({ name: Schema.String }),
      success: User,
    }),
  ),
)

const runtime = ManagedRuntime.make(FetchHttpClient.layer)
const queryClient = new QueryClient()

try {
  const client = await runtime.runPromise(
    HttpApiClient.make(usersApi, { baseUrl: 'http://localhost:3000' }),
  )
  const http = createHttpApiQueryUtils(usersApi, {
    client,
    keyPrefix: ['users-app'] as const,
    runPromiseExit: runtime.runPromiseExit,
  })

  const user = await queryClient.query(
    http.users.get.queryOptions({ input: { params: { id: 1 }, query: { locale: 'en' } } }),
  )
  console.log(user.name)

  const createUser = new MutationObserver(queryClient, http.users.create.mutationOptions())
  const created = await createUser.mutate({ payload: { name: 'Ada' } })
  console.log(created.id)
  await queryClient.invalidateQueries({ queryKey: http.users.key() })
} finally {
  try {
    await queryClient.cancelQueries()
  } finally {
    queryClient.clear()
    await runtime.dispose()
  }
}
```

HTTP input is the **decoded request**. Supply the endpoint's declared `params`, `query`, `headers`,
and `payload` containers; the client handles wire encoding. HTTP builders do not apply Schema
constructor defaults: this request explicitly supplies `locale: 'en'`.

The runtime provides the HTTP transport and forwards TanStack's signal through `runPromiseExit`.
Keep the runtime and client resources alive while queries and mutations use them. Invalidation is
application policy; this example refreshes the `users` endpoint prefix after creation.

Buffered nonmultipart endpoints offer query and mutation builders regardless of HTTP method;
buffered multipart endpoints offer mutations only. Literal group/endpoint names become utility
paths; dots require bracket access, and `topLevel: true` places endpoints at the root.
See [HTTP Factory](/effect-api-query/reference/http-factory/).

## Keep a browser client alive

The module above awaits its mutation before disposal. For components, acquire once before
mounting and keep the client alive for the application lifetime. Follow
[React client setup](/effect-api-query/guides/react-query/#acquire-and-mount-the-client) for a complete provider,
component, and cleanup callback.

For streams or concurrent writes, follow
[Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) before disposal. Continue with
[pagination](/effect-api-query/guides/pagination/),
[streaming](/effect-api-query/guides/streaming/), or
[HTTP metadata](/effect-api-query/guides/http-metadata/).
For request containers and file uploads, use
[HTTP Requests and Uploads](/effect-api-query/guides/http-queries-and-mutations/).
