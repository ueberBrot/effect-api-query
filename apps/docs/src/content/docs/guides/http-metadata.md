---
title: HTTP Metadata
description: Read decoded HTTP data, response status, and headers in a separate cache view.
---

Buffered HTTP endpoints with query support expose `metadataOptions`. Start with the ready `http`
utility tree and QueryClient from the [HTTP quick start](/effect-api-query/getting-started/http-quick-start/).
In this example, `users.get` declares `params.id` and `query.locale`. It returns a user with `id` and `name`.

## Read status and headers

```ts
const input = { params: { id: 1 }, query: { locale: 'en' } }
const metadataOptions = http.users.get.metadataOptions({ input })
const current = await queryClient.query(metadataOptions)
console.log(current.data.name, current.status)
const etag = current.headers['etag']
```

The cache holds decoded `data`, numeric `status`, and raw string `headers` in a separate view.
Fetched envelopes and copied headers are immutable. Decoded data retains its existing ownership,
including declared response-header wrappers. Before persistence or hydration, choose safe headers.
For exact access, use `metadataOptions.queryKey` or `metadataKey(input)`. The endpoint's `key()`
matches ordinary and metadata views.

## Update with an ETag

If `users.get` supplies an ETag and `users.update` declares `params.id`, an `if-match` header,
a `{ name }` payload, and its precondition failure, preserve the ETag for the write.
Import `MutationObserver` from `@tanstack/query-core`:

```ts
if (etag === undefined) throw new Error('The server supplied no ETag')
await queryClient.cancelQueries({ queryKey: http.users.get.key() })
const updateUser = new MutationObserver(
  queryClient,
  http.users.update.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: http.users.get.key() }),
  }),
)
```

Send the raw ETag with its quotes. Before another write, read the refreshed metadata:

```ts
await updateUser.mutate({
  params: input.params,
  headers: { 'if-match': etag },
  payload: { name: 'Ada' },
})
const refreshed = await queryClient.query(metadataOptions)
```

The server enforces the precondition. Inspect its declared failure through the
[HTTP execution error](/effect-api-query/guides/handle-failures/#inspect-http-failures).
The invalidation prefix refreshes data and metadata entries.

Native selection, initial data, skipping, and cancellation also apply. For details of immutability
and structural-sharing behavior, see [Buffered Metadata](/effect-api-query/reference/http-builders/#buffered-metadata).
