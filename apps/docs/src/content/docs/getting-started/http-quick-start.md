---
title: HTTP Quick Start
description: Turn an existing HttpApi and ready client into query and mutation options.
---

Use an existing `HttpApi`, ready `HttpApiClient`, and `QueryClient`. This example's
`usersApi` declares `users.get` with an integer `id` param and `locale` query field,
plus `users.create` with a `{ name }` payload.
First [install the package](/effect-api-query/getting-started/installation/).

Import `createHttpApiQueryUtils` from `effect-api-query` and `MutationObserver` from
`@tanstack/query-core`. The [complete typed recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-http-quick-start.ts)
contains the API and runtime setup; the [application examples](/effect-api-query/examples/)
contain runnable clients and handlers.

## Create the utilities

In the application client module, after acquiring the client:

```ts
const http = createHttpApiQueryUtils(usersApi, {
  client,
  keyPrefix: ['users-app'] as const,
  runPromiseExit: runtime.runPromiseExit,
})
```

Use the application's signal-aware runner when client execution needs services. Keep its
runtime and client resources alive while queries and mutations use them.

## Read a user

In a loader or event handler, use the existing `queryClient`:

```ts
const user = await queryClient.query(
  http.users.get.queryOptions({ input: { params: { id: 1 }, query: { locale: 'en' } } }),
)
```

HTTP input is the **decoded request**. Supply the endpoint's declared `params`, `query`,
`headers`, and `payload` containers; the client handles wire encoding. Even if the Schema
has a constructor default, HTTP builders do not fill it: this request supplies `locale`.

## Execute a write

Pass the complete decoded request to each mutation execution:

```ts
const createUser = new MutationObserver(queryClient, http.users.create.mutationOptions())
const created = await createUser.mutate({ payload: { name: 'Ada' } })
```

After success, refresh the affected reads:

```ts
await queryClient.invalidateQueries({ queryKey: http.users.key() })
```

Buffered nonmultipart endpoints offer query and mutation builders regardless of HTTP method;
buffered multipart endpoints offer mutations only. RPC and HTTP use separate namespaces,
so refresh both deliberately when they represent the same resource.

Literal group/endpoint names become utility paths; dots require bracket access, and
`topLevel: true` places endpoints at the root. See [HTTP Factory](/effect-api-query/reference/http-factory/).
Before disposal, follow [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/).
Continue with [HTTP Queries and Mutations](/effect-api-query/guides/http-queries-and-mutations/)
for metadata, uploads, pagination and SSE.
