# HTTP setup and rules

Use the application's existing HttpApi declaration and ready HttpApiClient. This standalone example requires a server at `http://localhost:3000` that implements the same declaration.

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
    runPromiseExit: runtime.runPromiseExit,
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
        await queryClient.invalidateQueries({ queryKey: http.users.key() });
      },
    })
  );
  await rename.mutate({ params: { id: 1 }, payload: { name: "Ada" } });
  const upload = new MutationObserver(
    queryClient,
    http.users.upload.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: http.users.key() }),
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

Ordinary groups produce `http[groupId][endpointId]`. Top-level groups put their endpoints at the root. Dots in HTTP identifiers remain literal properties, unlike the nested paths produced by dotted RPC tags.

Provide the declared `params`, `query`, `headers`, and ordinary `payload` containers with their decoded types. Buffered multipart payloads use explicit `FormData`. For a `Schema.FiniteFromString` field, pass a number. The client performs wire encoding. HTTP inputs receive no RPC constructor defaults. A declared container is required even when all its fields are optional. For an empty declared query container, use `{ query: {} }`.

Mutation variables use the same complete request shape. The adapter forces decoded-only responses. The input excludes raw-response controls. Text responses, binary responses, and declared response-header wrappers retain their decoded types.

Buffered endpoints without multipart expose query, infinite-query, and mutation builders. Any buffered multipart payload alternative makes the entire endpoint mutation-only. This includes mixed plain and multipart alternatives. Those leaves expose only `key()`, `mutationKey()`, and `mutationOptions()`, regardless of HTTP method. Mixed alternatives preserve Effect's client request union.

An endpoint with `success: []` uses Effect's no-content response and exposes buffered builders. Ordinary and infinite queries cache `null`; metadata contains `data: null`. Mutations retain the decoded `undefined` result.

An endpoint with exactly one SSE success exposes `streamedKey` and `streamedOptions` for ordered history. It exposes `liveKey` and `liveOptions` for the latest decoded value. Declared response-header wrappers surround each emission. Keep `sseOptions` beside decoded `input`. Accumulated keys and options require a positive `maxChunks` bound or `"unbounded"`, unless the configured leaf inherits retention. Live keys include decoder policy. Accumulated keys also include retention and refetch policy. Applications own reconnect and resume controls. Empty live completion raises `EffectHttpApiQueryEmptyStreamError`. A top-level `undefined` emission becomes `null`.

The adapter omits endpoints with raw byte streams, mixed buffered/SSE successes, multipart SSE payloads, or streaming multipart request alternatives. Empty groups disappear. To consume unsupported streams, use the underlying Effect client.

For protocols that send named events without a data line, set `sseOptions.dispatchEmptyNamedEvents: true` when the declared event Schema accepts empty data. Omission and false share the default identity; true selects a separate cache entry in both SSE views.

## Read buffered metadata

If a read needs decoded data, response status, or raw string headers, use `metadataOptions`. For typed cache access, use `metadataKey(input)`. Its `metadata` discriminator separates metadata from ordinary data. A leaf prefix matches both views. Metadata has no mutation or infinite builders. Multipart and streaming endpoints have no metadata view.

The adapter freezes fetched envelopes and their copied header records. Decoded `data` stays mutable and retains any declared decoded header wrapper. Only an entirely undefined success becomes `null`. The application owns initial data, hydration, manual writes, and selected results.

Native `select`, skipping, defaults, and cancellation apply. Global and prefix `structuralSharing` policies apply to fetched metadata snapshots. Selected results and later manual writes use the explicit policy passed to `metadataOptions`. If no policy is passed, they use standard deep sharing. An inherited sharing callback does not control those later values. A fresh-cache hit from `queryClient.query` does not replace an existing Query's options. Before relying on a changed policy for manual writes, install it through an observer or an actual fetch.

Before persisting raw headers, apply the application's disclosure policy. Header strings receive no inspection redaction.

## Consume decoded SSE

Keep decoder options beside the request. The following function accepts an already acquired client for the same declaration. It returns independent history and latest views:

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
    historyKey: http.events.watch.streamedKey(input, policy),
    latest: http.events.watch.liveOptions({
      input,
      sseOptions: policy.sseOptions,
    }),
  };
}
```

The accumulated key includes normalized `maxChunks`, `refetchMode`, and `sseOptions.maxEventSize`. The live key includes the decoder limit. That limit defaults to 10 MiB per SSE event, separately from the cache's element bound. Applications own reconnect, replay, and resume. For refetch visibility and retention, read [query patterns](query-patterns.md). For request capture, read [hydration and SSR](hydration-and-ssr.md).

## Multipart mutations

The example declares `users.upload` with a buffered multipart file payload and numeric `params.id`. Build the multipart fields and files explicitly in `FormData`. When calling `mutate`, pass that value as `payload` alongside the decoded request containers.

The adapter forwards the original `FormData` to the ready client. Decoded success, callback variables, execution services, and the error Cause follow the ordinary mutation contract. Keep multipart mutation-only endpoints out of `keyEncoders`. The adapter rejects encoder entries because mutation variables and files never enter query identity.

## Key encoding

For default keys, the adapter synchronously schema-encodes labeled request parts. It omits encoded undefined object members and retains array order and encoded null. Header names become lowercase. Conflicting duplicate header names fail. These rules govern default encoding. They do not govern custom encoder output.

Configure custom encoders under declaration group and endpoint identifiers: `keyEncoders: { groupId: { endpointId: encoder } }`. Use that structure for top-level groups too. The encoder receives the complete decoded request. For endpoints with query support, provide an encoder if encoding requires services, uses opaque middleware, contains explicit redacted values, or declares multiple payload alternatives. Runtime middleware inspection is conservative even for synchronous service-free encoding. Binary query inputs need a JSON-safe projection, such as an array of bytes.

Return strict synchronous `JsonValue`. Preserve differences in body and content type between alternatives, even if two schemas encode to the same scalar. An encoder supplies only identity. The client still encodes requests, and the runner must provide required services. Keep ordinary authentication in client middleware. Use safe identity partitions in the key prefix.

Sources: [HTTP factory](https://ueberbrot.github.io/effect-api-query/reference/http-factory/), [HTTP builders](https://ueberbrot.github.io/effect-api-query/reference/http-builders/).

Metadata fetched through the generated query retains its sharing and freezing guarantees when observers rebuild options during a pending fetch. Manual cache writes and hydrated envelopes follow the documented local policy and remain application-owned. Do not assume a fresh imperative cache hit installs new options.
