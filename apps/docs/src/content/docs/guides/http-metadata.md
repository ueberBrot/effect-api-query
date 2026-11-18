---
title: HTTP Metadata
description: Read decoded HTTP data, response status, and headers in a separate cache view.
---

Use `metadataOptions` when you need the HTTP status or headers alongside decoded data. Start with the [HTTP quick start](/effect-api-query/getting-started/http-quick-start/) utilities and QueryClient.

## Read status and headers

```ts
const input = { params: { id: 1 }, query: { locale: "en" } };
const metadataOptions = http.users.get.metadataOptions({ input });
const current = await queryClient.query(metadataOptions);
console.log(current.data.name, current.status);
const etag = current.headers["etag"];
```

This view caches decoded `data` with a numeric `status` and raw string `headers`. Each fetched envelope and header snapshot is frozen, even if you rebuild observer options during the request. A local structural-sharing callback overrides inherited defaults. Decoded data, including declared header wrappers, stays application-owned. Use `metadataKey(input)` or the options' `queryKey` for an exact match. The endpoint prefix matches both views.

## Update with an ETag

Use an ETag to update the version you read. This example assumes `users.update` declares `params.id`, an `if-match` header, a `{ name }` payload, and a precondition error. Import `MutationObserver` from `@tanstack/query-core`.

```ts
if (etag === undefined) throw new Error("The server supplied no ETag");
await queryClient.cancelQueries({ queryKey: http.users.get.key() });
const updateUser = new MutationObserver(
  queryClient,
  http.users.update.mutationOptions({
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: http.users.get.key() }),
  })
);
```

Pass the ETag with its quotes. Fetch updated metadata before you write again.

```ts
await updateUser.mutate({
  params: input.params,
  headers: { "if-match": etag },
  payload: { name: "Ada" },
});
const refreshed = await queryClient.query(metadataOptions);
```

The server enforces the precondition. Inspect rejection through the [HTTP execution error](/effect-api-query/guides/handle-failures/#inspect-http-failures). The invalidation prefix matches both data and metadata. Active matches refetch by default.

Metadata queries support native selection, initial data, skipping, and cancellation. See [buffered metadata](/effect-api-query/reference/http-builders/#buffered-metadata) for sharing and immutability.

For server rendering, register `queryViewCodec(http.users.get, 'metadata', MetadataCodec)` alongside the ordinary codec. Describe decoded data, numeric status, and raw string headers. Preserve any decoded header wrapper inside `data`. Transfer only public headers. The app owns hydrated envelopes. The next metadata fetch produces a frozen snapshot. See [register a view codec](/effect-api-query/guides/hydrate-query-views/#register-generated-leaves-and-views).
