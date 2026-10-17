---
title: External HTTP Clients
description: Generated OpenAPI consumers, encoded request values, multipart uploads, and raw SSE limits.
---

An external HTTP client can call an Effect HttpApi server through its declared HTTP contract.
For example, `openapi-typescript` generates `paths` from the JSON document returned by native
`OpenApi.fromApi(api)`. The generated types describe calls made with `openapi-fetch`.
The examples target `openapi-fetch` 0.17.0, `openapi-typescript` 7.13.0, and Effect 4.0.2.

`createHttpApiQueryUtils` accepts a ready Effect HttpApiClient with a native Effect runner.
An external Promise client calls HTTP independently. Compatibility with the declared HTTP contract
does not establish compatibility with the Effect RPC wire protocol.

## Encoded and decoded values

OpenAPI describes encoded HTTP values. An endpoint using `Schema.NumberFromString` accepts a
string on the wire and a number through the ready Effect client. A generated external client
returns a plain encoded DTO. Native Schema decoding constructs the domain value.
The external client's generated types provide no runtime Schema decoding or validation.

| Value                   | External client                   | Ready Effect client                                                |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------ |
| Request path parameter  | `params.path.id: '5'`             | `params.id: 5`                                                     |
| Request query parameter | `params.query.limit: '2'`         | `query.limit: 2`                                                   |
| Declared request header | `params.header['x-factor']: '3'`  | `headers['x-factor']: 3`                                           |
| JSON request payload    | `body.amount: '7'`                | `payload.amount: 7`                                                |
| Response body           | Plain object with `total: '17'`   | Schema class with `total: 17` and methods                          |
| Response headers        | Raw strings on `response.headers` | Decoded declared header wrapper, with raw strings in metadata view |

## Call the declared HTTP contract

The server's OpenAPI document supplies `paths`. Declared paths, headers, success responses, and
error responses determine the external client interface. The utility tree's decoded input does not.

The external client module uses the generated `paths` type:

```ts
import createClient from 'openapi-fetch'

import type { paths } from './openapi-generated.ts'

const external = createClient<paths>({ baseUrl: 'https://api.example.test' })
```

For a contract declaring `POST /reports/:id` with these fields, the request contains encoded values:

```ts
const report = await external.POST('/reports/{id}', {
  params: {
    path: { id: '5' },
    query: { limit: '2', labels: ['a b', 'c+d'] },
    header: { 'x-factor': '3' },
  },
  body: { amount: '7', title: 'Quarter 1' },
})
if (report.error) {
  throw new Error(`Report failed with HTTP ${report.response.status}`)
}
const revision = report.response.headers.get('x-revision')
```

Declared failures appear in `error`, with the status in `response.status`.
The external client does not construct an Effect execution-error wrapper.
Its `Response` retains status and raw headers. The native
[metadata view](/effect-api-query/reference/http-builders/#buffered-metadata) retains decoded data
alongside immutable plain snapshots of status and headers.

Array query parameters use repeated names, including a single-element array. JSON array
responses retain their ordinary representation.

## Serialize multipart uploads explicitly

The generator's `transform` hook supports mapping a binary schema to `Blob`.
Multipart uploads require a `bodySerializer` that builds `FormData` from declared text fields and
files while preserving filenames. Fetch sets the multipart boundary.
The default JSON serializer receives HTTP 415 from a multipart-only endpoint.
The ready Effect client takes `FormData` directly as its decoded payload.
See [Upload a File](/effect-api-query/guides/http-queries-and-mutations/#upload-a-file).

## SSE boundary

The `parseAs: 'stream'` option returns a raw `ReadableStream<Uint8Array>`.
It does not parse events, decode Schema values, or turn a reserved failure event into an error.
Default JSON parsing fails on an SSE response.

Effect's SSE data mode encodes each value as JSON in an event's `data` field.
A custom event can also carry `id` and `event`. A stream failure uses the reserved event name
`effect/http-api/stream/failure` and an encoded Cause body. HTTP status remains 200.
The generated document records these details in `x-effect-stream`, which this client does not consume.
Typed SSE consumption requires the native ready Effect client or a compatible decoder owned by the
application. Raw stream access alone gives no typed SSE guarantee.

See the [external client's API](https://openapi-ts.dev/openapi-fetch/api) and
[generator's Node API](https://openapi-ts.dev/node) for their configuration.
