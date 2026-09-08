---
title: HTTP Quick Start
description: Declare an HttpApi, own a ready client, and run a generated query and mutation.
---

This tutorial connects an Effect HttpApi client to TanStack Query Core. You will declare two
endpoints, acquire a ready client, read a user, and create another user.

First [install the package](/effect-api-query/getting-started/installation/). Use a server that
implements the declaration below at `http://localhost:3000`, with an existing user with ID `1`.
Change the base URL to your server. For browser requests, configure the server's CORS policy to
allow the application's origin.
For complete HTTP handlers and applications, [run the examples](/effect-api-query/examples/).

## Declare, connect, and call

Save this as `http-client.ts` in your application. Share the HttpApi declaration with your server;
keep the runtime, client, and `QueryClient` in the application that manages their lifetime.

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, ManagedRuntime, Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import { FetchHttpClient } from 'effect/unstable/http'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

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

`HttpApiClient.make` creates a ready client using the application's Fetch runtime. Pass that same
runtime's `runPromiseExit` to the factory so generated calls use that runner and
forward TanStack's query abort signal.

HTTP input is the client's decoded request, with the `params`, `query`, `headers`, and `payload`
containers declared by the endpoint. Pass `id` as a number; the client handles its wire encoding.
The POST mutation receives `{ payload: { name: 'Ada' } }`.

The request must supply `query: { locale: 'en' }` even though `locale` has a constructor default.
HTTP builders do not construct RPC payloads or fill constructor defaults.

Groups and endpoint identifiers retain their literal names. `users` and `get` produce
`http.users.get`; a name containing a dot would require bracket access. A group declared with
`topLevel: true` places its endpoints at the utility root.

## Choose cache and resource ownership

Every supported endpoint offers both query and mutation builders, regardless of HTTP method.
Choose a query for an idempotent cached read and a mutation for a command. After a write, invalidate
the affected keys explicitly. RPC and HTTP have separate key namespaces, so applications that
expose the same resource through both must invalidate both.

The `finally` block cancels queries, clears the cache, and disposes the runtime. Keep these resources
alive for the application lifetime in a UI, and settle pending mutations before disposal. Include a
safe user or tenant identity in `keyPrefix` whenever client configuration affects returned data.

The repository compiles this complete snippet against the public package root in
[`tests/types/docs-http-quick-start.ts`](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-http-quick-start.ts)
and checks that this page matches it. Continue with
[HTTP queries and mutations](/effect-api-query/guides/http-queries-and-mutations/) and the
[HTTP factory reference](/effect-api-query/reference/http-factory/).
