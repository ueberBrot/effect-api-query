---
title: External HTTP Clients
description: Generated OpenAPI consumers, encoded request values, multipart uploads, and raw SSE limits.
---

An external HTTP client can call an Effect HttpApi server through its declared HTTP contract.
The supported combination is `openapi-fetch` 0.17.0 with `openapi-typescript` 7.13.0 and Effect 4.0.0.
Generate `paths` from the JSON document returned by native `OpenApi.fromApi(api)`.

`createHttpApiQueryUtils` accepts a ready Effect HttpApiClient. Keep that client and its runner
native; the external Promise client calls HTTP independently. This interoperability does not
establish compatibility with the Effect RPC wire protocol.

## Encoded and decoded values

OpenAPI describes encoded HTTP values. An endpoint using `Schema.NumberFromString` accepts a
string on the wire and a number through the ready Effect client. A generated external client
returns a plain encoded DTO; native Schema decoding constructs the domain value.
The external client's generated types add no runtime Schema decoding or validation.

| Value                   | External client                   | Ready Effect client                                           |
| ----------------------- | --------------------------------- | ------------------------------------------------------------- |
| Request path parameter  | `params.path.id: '5'`             | `params.id: 5`                                                |
| Request query parameter | `params.query.limit: '2'`         | `query.limit: 2`                                              |
| Declared request header | `params.header['x-factor']: '3'`  | `headers['x-factor']: 3`                                      |
| JSON request payload    | `body.amount: '7'`                | `payload.amount: 7`                                           |
| Response body           | Plain object with `total: '17'`   | Schema class with `total: 17` and methods                     |
| Response headers        | Raw strings on `response.headers` | Decoded declared header wrapper; raw strings in metadata view |

## Buffered requests and uploads

The report contract below declares `POST /reports/:id`, a JSON payload, query and header fields,
and a 203 response. Its missing-report response has status 404 and a tagged JSON body. An update
uses `PATCH` and declares a 409 conflict. Read declared failures through `error` and inspect
`response.status`; the external client does not construct an Effect execution-error wrapper.

Array query parameters use repeated names, including a single-element array. JSON array
responses retain their ordinary JSON representation. This scope does not include GET payloads
or form-urlencoded payloads.

For `multipart/form-data`, map a binary schema to `Blob` with the generator's `transform` hook.
Use a `bodySerializer` that returns `FormData`. Let Fetch set the multipart boundary; the default
JSON serializer receives HTTP 415 from a multipart-only endpoint. The example upload includes
path/query/header values, a text field, and a file with its filename and contents intact.

```ts
import createClient from 'openapi-fetch'

import type { paths } from './openapi-generated.ts'

const external = createClient<paths>({ baseUrl: 'https://api.example.test' })
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

const uploaded = await external.POST('/reports/{id}/files', {
  params: {
    path: { id: '5' },
    query: { revision: '3' },
    header: { 'x-kind': 'document' },
  },
  body: { title: 'Notes', file: new File(['contents'], 'notes.txt') },
  bodySerializer: (body) => {
    const form = new FormData()
    form.set('title', body.title)
    form.set('file', body.file)
    return form
  },
})
const events = await external.GET('/reports/events/{channel}', {
  params: { path: { channel: 'values' } },
  parseAs: 'stream',
})
export { events, report, revision, uploaded }
```

The external client's `Response` retains HTTP status and raw headers after buffering. The native
HTTP metadata view retains decoded data with immutable plain status/header snapshots. These
are distinct representations.

## SSE boundary

`parseAs: 'stream'` returns a raw `ReadableStream<Uint8Array>`. It does not parse events, decode
Schema values, or turn a reserved failure event into an error. Default JSON parsing fails on
an SSE response.

Effect's SSE data mode encodes each value as JSON in an event's `data` field. A custom event can
also carry `id` and `event`. A stream failure uses the reserved event name
`effect/http-api/stream/failure` and an encoded Cause body while HTTP status remains 200.
The generated document records these details in `x-effect-stream`; this client does not consume
that extension. Typed SSE consumption requires the native ready Effect client or an
application-owned compatible decoder. Raw stream access alone gives no typed SSE guarantee.

See the [external client's API](https://openapi-ts.dev/openapi-fetch/api) and
[generator's Node API](https://openapi-ts.dev/node) for their configuration.
