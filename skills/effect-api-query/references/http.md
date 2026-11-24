# HTTP setup and rules

Start with the app's HttpApi declaration and ready client. To run this example, serve the same API at `http://localhost:3000`.

```ts
import { MutationObserver, QueryClient } from "@tanstack/query-core";
import { createHttpApiQueryUtils } from "@ueberbrot/effect-api-query";
import { ManagedRuntime, Schema } from "effect";
import { FetchHttpClient, Multipart } from "effect/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";

const users = HttpApi.make("users-api").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("get", "/users/:id", {
      params: { id: Schema.Int },
      success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    }),
    HttpApiEndpoint.post("rename", "/users/:id", {
      params: { id: Schema.Int },
      payload: Schema.Struct({ name: Schema.String }),
      success: Schema.Void,
    }),
    HttpApiEndpoint.post("upload", "/users/:id/files", {
      params: { id: Schema.Int },
      payload: Schema.Struct({ file: Multipart.SingleFileSchema }).pipe(
        HttpApiSchema.asMultipart()
      ),
      success: Schema.Struct({ name: Schema.String }),
    })
  )
);
const runtime = ManagedRuntime.make(FetchHttpClient.layer);
const queryClient = new QueryClient();

try {
  const client = await runtime.runPromise(
    HttpApiClient.make(users, { baseUrl: "http://localhost:3000" })
  );
  const http = createHttpApiQueryUtils(users, {
    client,
    keyPrefix: ["users-app"],
    runtime,
  });
  await queryClient.query(
    http.users.get.queryOptions({
      input: { params: { id: 1 } },
      staleTime: 30_000,
    })
  );
  const metadata = await queryClient.query(
    http.users.get.metadataOptions({ input: { params: { id: 1 } } })
  );
  console.log(metadata.data.name, metadata.status, metadata.headers["etag"]);
  const rename = new MutationObserver(
    queryClient,
    http.users.rename.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(http.users.queryFilter());
      },
    })
  );
  await rename.mutate({ params: { id: 1 }, payload: { name: "Ada" } });
  const upload = new MutationObserver(
    queryClient,
    http.users.upload.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(http.users.queryFilter()),
    })
  );
  const payload = new FormData();
  payload.set(
    "file",
    new Blob(["profile notes"], { type: "text/plain" }),
    "notes.txt"
  );
  await upload.mutate({ params: { id: 1 }, payload });
} finally {
  try {
    await queryClient.cancelQueries();
  } finally {
    queryClient.clear();
    await runtime.dispose();
  }
}
```

## Tree and request semantics

Use `http[groupId][endpointId]` for an ordinary group and `http[endpointId]` for a top-level group. Keep dots in names as literal characters.

Pass each declared decoded `params`, `query`, `headers`, and `payload` object. An empty query still takes `{ query: {} }` if the declaration includes it. Pass a number for `Schema.FiniteFromString`. The client encodes it. Supply HTTP defaults yourself. Pass `FormData` for buffered multipart.

Pass the same decoded request as mutation variables. Leave out raw-response controls. Decoded text, binary, and declared header wrappers retain their types.

Buffered endpoints without multipart support queries, pagination, and mutations. If any buffered alternative is multipart, the leaf exposes only `key()`, `mutationKey()`, and `mutationOptions()`. This holds for any HTTP method. The client's request union still covers mixed plain and multipart input.

With `success: []`, ordinary and infinite queries cache `null`, metadata contains `data: null`, and mutations return the decoded `undefined`.

For one SSE or NDJSON success, use `streamedOptions` for ordered history or `liveOptions` for the latest value. Each view has its own key and preserves decoded header wrappers. Set `maxChunks` for accumulated history or inherit it through policy. For SSE, place `sseOptions` beside `input` or set [leaf policy defaults](cache-workflows.md#assemble-contract-associated-policies). Match local overrides when building keys. A live stream that completes before its first value raises `EffectHttpApiQueryEmptyStreamError`. An abort follows native cancellation. Live queries convert a whole `undefined` to `null`.

Use the ready client for raw bytes, HTTP upgrades, mixed buffered and streamed successes, or streaming request payloads. The factory omits those endpoints, streamed successes with multipart inputs, and groups with no supported endpoints.

If the Schema accepts named events without a data line, set `sseOptions.dispatchEmptyNamedEvents: true`. This uses a different key in both views. Omitted and false share a key.

## Read buffered metadata

Use `metadataOptions` for decoded data with response status and raw headers. Use `metadataKey({ input })` for exact cache access. Its `metadata` segment separates it from the ordinary view. The leaf prefix matches both. This view is available only on query-capable buffered endpoints.

The adapter freezes the fetched envelope and its copied headers. It keeps decoded data and declared wrappers as returned. Only a whole `undefined` becomes `null`. The app owns initial, hydrated, manual, and selected values.

Global and prefix sharing policies apply to fetched snapshots. Selected values and manual writes use the local policy passed to `metadataOptions` or standard deep sharing. A fresh-cache hit keeps the query's installed options. Use an observer or actual fetch to install a new policy. Native selection, defaults, skipping, and cancellation still apply.

Select public headers before persistence or hydration. Raw header strings have no inspection redaction.

## Consume decoded SSE

Pass decoder options beside the request. The function takes a ready client and returns separate history and latest-value views.

```ts
import { createHttpApiQueryUtils } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";

export const eventsApi = HttpApi.make("events-api").add(
  HttpApiGroup.make("events").add(
    HttpApiEndpoint.get("watch", "/events", {
      query: { channel: Schema.String },
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
    })
  )
);

export function httpEventOptions(
  client: HttpApiClient.ForApi<typeof eventsApi>
) {
  const http = createHttpApiQueryUtils(eventsApi, {
    client,
    keyPrefix: ["events-app"],
  });
  const input = { query: { channel: "news" } };
  const policy = {
    maxChunks: 100,
    refetchMode: "append" as const,
    sseOptions: { maxEventSize: 1_048_576 },
  };
  return {
    history: http.events.watch.streamedOptions({ input, ...policy }),
    historyKey: http.events.watch.streamedKey({ input, ...policy }),
    latest: http.events.watch.liveOptions({
      input,
      sseOptions: policy.sseOptions,
    }),
  };
}
```

Accumulated keys include history and decoder policy. Live keys include decoder policy and any coalescing interval. The parser limit defaults to 10 × 1024 × 1024 JavaScript string code units. Set it separately from the history bound. Put resume state in the app. See [query patterns](query-patterns.md) for publication and [hydration](hydration-and-ssr.md) for capture.

## Consume decoded NDJSON

For one `HttpApiSchema.StreamNdjson` success, use ordinary streamed or live builders. Effect owns framing, decoding, and the declaration's `maxElementBytes`. Use `sseOptions` only for SSE. Keep declared `WithHeaders` wrappers.

```ts
import { createHttpApiQueryUtils } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import type { HttpApiClient } from "effect/http-api";

export const recordsApi = HttpApi.make("records-api").add(
  HttpApiGroup.make("records").add(
    HttpApiEndpoint.get("watch", "/records", {
      success: HttpApiSchema.StreamNdjson({
        schema: Schema.Struct({ id: Schema.FiniteFromString }),
        maxElementBytes: "1 MiB",
      }),
    })
  )
);

export function recordOptions(client: HttpApiClient.ForApi<typeof recordsApi>) {
  const http = createHttpApiQueryUtils(recordsApi, {
    client,
    keyPrefix: ["records-app"],
  });
  return {
    history: http.records.watch.streamedOptions({ maxChunks: 100 }),
    latest: http.records.watch.liveOptions(),
  };
}
```

Pass the options to native Query consumers. A record `{"id":"1"}` decodes to `{ id: 1 }`. HTTP and Schema failures keep their Cause. NDJSON uses the ready client's error channel. An empty accumulated query can succeed. Keep the client alive until local cleanup completes.

## Multipart mutations

To call the example's `users.upload`, build `FormData` and pass it as `payload` with the other declared request parts when you call `mutate`.

The client receives the original `FormData`. Mutation types and failures follow the ordinary contract. Leave these endpoints out of `keyEncoders` because their variables and files stay out of keys.

## Key encoding

Default encoding uses the HTTP parse options for each labeled request part. It omits encoded `undefined` members and keeps array order and `null`. It lowercases header names. Duplicate names must have equivalent encoded values. Object key order does not affect that comparison. For URL-encoded request parts, default encoding also preserves repeated wire-parameter ordering when multiple entries flatten to the same serialized parameter name. A custom encoder defines its own shape.

Configure `keyEncoders: { groupId: { endpointId: encoder } }`, including for a top-level group. The encoder receives the complete decoded request. For queries, supply one for encoding services, opaque middleware, `Schema.Redacted` or `HttpApi.RedactedNames` input, or multiple payload alternatives. Runtime validation also requires an encoder when TypeScript merges alternatives that share one decoded type. For binary values, project to JSON, for example an array of bytes.

Return strict JSON synchronously. Preserve body and content-type differences that affect results. Supply execution services separately through the runner. Keep credentials in middleware and safe identity in the prefix.

See [HTTP factory](https://ueberbrot.github.io/effect-api-query/reference/http-factory/) for endpoint support and [HTTP builders](https://ueberbrot.github.io/effect-api-query/reference/http-builders/) for shapes and failures.

Keep captured request values unchanged, including nested values. A frozen key does not freeze the request. Build new options for new input. Preparation errors throw before execution. For repeated inputs, see [prepared input](query-patterns.md#prepare-a-reused-input).
