---
title: HTTP Requests and Uploads
description: Supply decoded request parts and execute buffered multipart mutations.
---

Start with the utility tree from the [HTTP quick start](/effect-api-query/getting-started/http-quick-start/). Set the base URL, authentication, middleware, and required services on your Effect client and runner.

## Supply decoded request parts

Pass the decoded `params`, `query`, `headers`, and `payload` that the endpoint declares. Supply each declared object, even if its fields are optional. This endpoint takes `params.id` and `query.locale`.

```ts
const httpUserOptions = http.users.get.queryOptions({
  input: { params: { id: 1 }, query: { locale: "en" } },
  staleTime: 30_000,
});
const httpUser = await queryClient.query(httpUserOptions);
```

The ready client encodes the request. Pass defaults explicitly. For an endpoint with no input, call `queryOptions()`. Keep response controls out of the input and keep request values unchanged while the options can run.

## Upload a file

In the contract module, declare a buffered multipart payload. Import `Schema` from `effect`, `Multipart` from `effect/http`, and `HttpApiEndpoint` and `HttpApiSchema` from `effect/http-api`.

```ts
const upload = HttpApiEndpoint.post("upload", "/users/:id/files", {
  params: { id: Schema.Int },
  payload: Schema.Struct({ file: Multipart.SingleFileSchema }).pipe(
    HttpApiSchema.asMultipart()
  ),
  success: Schema.Struct({ name: Schema.String }),
});
```

Add the endpoint to the `users` group and create its utility tree. In the mutation module, import `MutationObserver` from `@tanstack/query-core`.

```ts
const uploadFile = new MutationObserver(
  queryClient,
  http.users.upload.mutationOptions({
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: http.users.key() }),
  })
);
```

In the event handler, build `FormData` and supply the other request objects the endpoint declares.

```ts
const payload = new FormData();
payload.set(
  "file",
  new Blob(["profile notes"], { type: "text/plain" }),
  "notes.txt"
);
const uploaded = await uploadFile.mutate({ params: { id: 1 }, payload });
```

The ready client encodes the request and returns decoded success. A buffered multipart alternative makes the endpoint mutation-only. Variables and files stay out of the cache key. The factory rejects `keyEncoders` entries for these endpoints. It omits endpoints with streaming successes or streaming multipart alternatives.

See the [HTTP factory](/effect-api-query/reference/http-factory/) for supported request shapes and the [multipart test](https://github.com/ueberBrot/effect-api-query/blob/main/tests/http-multipart.test.ts) for a complete example.
