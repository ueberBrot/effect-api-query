---
title: HTTP Requests and Uploads
description: Supply decoded request parts and execute buffered multipart mutations.
---

Use the HTTP utility tree from the [HTTP quick start](/effect-api-query/getting-started/http-quick-start/). Configure the base URL, middleware, authentication, and execution services on your ready client and runner. For shared builders, see [Queries](/effect-api-query/guides/queries/), [Mutations](/effect-api-query/guides/mutations/), [Pagination](/effect-api-query/guides/pagination/), [Streaming](/effect-api-query/guides/streaming/), and [HTTP Metadata](/effect-api-query/guides/http-metadata/).

## Supply decoded request parts

HTTP input contains the declared `params`, `query`, `headers`, and `payload` containers. Include each declared container, even when its fields are optional. This `users.get` endpoint declares `params.id` and `query.locale`:

```ts
const httpUserOptions = http.users.get.queryOptions({
  input: { params: { id: 1 }, query: { locale: "en" } },
  staleTime: 30_000,
});
const httpUser = await queryClient.query(httpUserOptions);
```

The ready client encodes decoded values. HTTP builders apply no RPC constructor defaults. Inputless endpoints use `queryOptions()`. Raw response controls are excluded from request input. You own the captured values. Keep them unchanged while the options can execute.

## Upload a file

In the contract module, declare a buffered multipart payload. Import `Schema` from `effect`, `Multipart` from `effect/http`, and `HttpApiEndpoint` and `HttpApiSchema` from `effect/http-api`:

```ts
const upload = HttpApiEndpoint.post("upload", "/users/:id/files", {
  params: { id: Schema.Int },
  payload: Schema.Struct({ file: Multipart.SingleFileSchema }).pipe(
    HttpApiSchema.asMultipart()
  ),
  success: Schema.Struct({ name: Schema.String }),
});
```

Add the endpoint to your API's `users` group and create its utility tree. In the mutation module, import `MutationObserver` from `@tanstack/query-core` and prepare the upload:

```ts
const uploadFile = new MutationObserver(
  queryClient,
  http.users.upload.mutationOptions({
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: http.users.key() }),
  })
);
```

In the event handler, build `FormData` and supply the other declared request containers:

```ts
const payload = new FormData();
payload.set(
  "file",
  new Blob(["profile notes"], { type: "text/plain" }),
  "notes.txt"
);
const uploaded = await uploadFile.mutate({ params: { id: 1 }, payload });
```

The ready client owns encoding. The adapter returns decoded success. Any buffered multipart payload alternative makes the endpoint mutation-only. Mutation keys exclude variables and files. Omit these endpoints from `keyEncoders`, because the factory rejects their encoder entries. Streaming successes or streaming multipart alternatives omit the endpoint entirely.

See the [HTTP Factory](/effect-api-query/reference/http-factory/) for exact capability boundaries and the [multipart example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/http-multipart.test.ts) for a complete contract and execution.
