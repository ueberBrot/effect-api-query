---
title: External HTTP Clients
description: Generated OpenAPI consumers, encoded request values, multipart uploads, and raw SSE limits.
---

Use `OpenApi.fromApi(api)` to produce the server's OpenAPI document. Generate `paths` with `openapi-typescript` and use them with `openapi-fetch`. The example uses `openapi-fetch` 0.17.0, `openapi-typescript` 7.13.0, and Effect 4.1.0.

The external client calls the HTTP contract directly. To use `createHttpApiQueryUtils`, acquire an Effect HttpApiClient. Effect RPC uses its own wire protocol.

## Encoded and decoded values

OpenAPI describes values sent over HTTP. With `Schema.NumberFromString`, the wire takes a string and the Effect client takes a number. The external client's generated types describe the wire values. Use Effect Schema if you need runtime validation or decoded domain values.

| Value | External client | Ready Effect client |
| --- | --- | --- |
| Request path parameter | `params.path.id: '5'` | `params.id: 5` |
| Request query parameter | `params.query.limit: '2'` | `query.limit: 2` |
| Declared request header | `params.header['x-factor']: '3'` | `headers['x-factor']: 3` |
| JSON request payload | `body.amount: '7'` | `payload.amount: 7` |
| Response body | Plain object with `total: '17'` | Schema class with `total: 17` and methods |
| Response headers | Raw strings on `response.headers` | Decoded declared header wrapper, with raw strings in metadata view |

## Call the declared HTTP contract

Generate `paths` from the server document. It describes paths, headers, successes, and failures in their encoded form.

Pass the generated type to the client.

```ts
import createClient from "openapi-fetch";

import type { paths } from "./openapi-generated.ts";

const external = createClient<paths>({ baseUrl: "https://api.example.test" });
```

This `POST /reports/:id` call sends encoded values.

```ts
const report = await external.POST("/reports/{id}", {
  params: {
    path: { id: "5" },
    query: { limit: "2", labels: ["a b", "c+d"] },
    header: { "x-factor": "3" },
  },
  body: { amount: "7", title: "Quarter 1" },
});
if (report.error) {
  throw new Error(`Report failed with HTTP ${report.response.status}`);
}
const revision = report.response.headers.get("x-revision");
```

Read declared failures from `error` and status from `response.status`. The native `Response` retains headers. Use the Effect client's [metadata view](/effect-api-query/reference/http-builders/#buffered-metadata) if you need decoded data with frozen status and header snapshots.

Use repeated names for array query parameters, even for an array with one item. JSON array responses stay arrays.

## Serialize multipart uploads explicitly

Use the generator's `transform` hook to map binary schemas to `Blob`. Build `FormData` in a `bodySerializer` and preserve filenames. Fetch sets the multipart boundary. A JSON body gets HTTP 415 on a multipart-only endpoint. For the ready Effect client, pass `FormData` directly. See [upload a file](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file).

## SSE boundary

Use `parseAs: 'stream'` to read raw bytes as `ReadableStream<Uint8Array>`. Supply an SSE decoder to parse events and recognize the failure event. Default JSON parsing fails for SSE.

Effect's data mode encodes each value as JSON in the SSE `data` field. Custom events can include `id` and `event`. The server sends a failure as `effect/http-api/stream/failure` with an encoded Cause while the HTTP status remains 200. The OpenAPI document records this in `x-effect-stream`. Use Effect's client or an application decoder that handles this format.

See the [client API](https://openapi-ts.dev/openapi-fetch/api) and [generator API](https://openapi-ts.dev/node) for configuration.
