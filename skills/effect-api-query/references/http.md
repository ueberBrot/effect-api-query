# HTTP setup and rules

Use the application's existing HttpApi declaration and ready HttpApiClient. This
standalone example expects a server at `http://localhost:3000` implementing the
same declaration.

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { ManagedRuntime, Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import { FetchHttpClient, Multipart } from 'effect/http'
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api'

const users = HttpApi.make('users-api').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    }),
    HttpApiEndpoint.post('rename', '/users/:id', {
      params: { id: Schema.Int },
      payload: Schema.Struct({ name: Schema.String }),
      success: Schema.Void,
    }),
    HttpApiEndpoint.post('upload', '/users/:id/files', {
      params: { id: Schema.Int },
      payload: Schema.Struct({ file: Multipart.SingleFileSchema }).pipe(
        HttpApiSchema.asMultipart(),
      ),
      success: Schema.Struct({ name: Schema.String }),
    }),
  ),
)
const runtime = ManagedRuntime.make(FetchHttpClient.layer)
const queryClient = new QueryClient()

try {
  const client = await runtime.runPromise(
    HttpApiClient.make(users, { baseUrl: 'http://localhost:3000' }),
  )
  const http = createHttpApiQueryUtils(users, {
    client,
    keyPrefix: ['users-app'],
    runPromiseExit: runtime.runPromiseExit,
  })
  await queryClient.query(
    http.users.get.queryOptions({ input: { params: { id: 1 } }, staleTime: 30_000 }),
  )
  const metadata = await queryClient.query(
    http.users.get.metadataOptions({ input: { params: { id: 1 } } }),
  )
  console.log(metadata.data.name, metadata.status, metadata.headers['etag'])
  const rename = new MutationObserver(
    queryClient,
    http.users.rename.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: http.users.key() })
      },
    }),
  )
  await rename.mutate({ params: { id: 1 }, payload: { name: 'Ada' } })
  const upload = new MutationObserver(
    queryClient,
    http.users.upload.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: http.users.key() }),
    }),
  )
  const payload = new FormData()
  payload.set('file', new Blob(['profile notes'], { type: 'text/plain' }), 'notes.txt')
  await upload.mutate({ params: { id: 1 }, payload })
} finally {
  try {
    await queryClient.cancelQueries()
  } finally {
    queryClient.clear()
    await runtime.dispose()
  }
}
```

## Tree and request semantics

Ordinary groups produce `http[groupId][endpointId]`; top-level groups put their
endpoints at the root. Dots in HTTP identifiers remain literal properties. This
differs from dotted RPC tag projection.

Provide the declared `params`, `query`, `headers`, and ordinary `payload` containers in
their decoded types. Buffered multipart payloads use explicit `FormData`. For a
`Schema.FiniteFromString` field, pass a number; the client performs wire encoding.
HTTP inputs receive no RPC constructor defaults.
A declared container remains required even if all fields inside it are optional:
use `{ query: {} }` for an empty declared query container.

Mutation variables use that same complete request shape. The adapter forces
decoded-only responses; raw-response controls are not part of the input. Text
responses, binary responses, and declared response-header wrappers keep their decoded types.

Buffered endpoints without multipart expose query, infinite-query, and mutation
builders. Any buffered multipart payload alternative makes the whole endpoint
mutation-only, including mixed plain and multipart alternatives. Those leaves expose
only `key()`, `mutationKey()`, and `mutationOptions()`, regardless of HTTP method.
Mixed alternatives preserve Effect's client request union.

An endpoint with exactly one SSE success exposes `streamedKey` / `streamedOptions` for
ordered history and `liveKey` / `liveOptions` for the latest decoded value. Declared
response-header wrappers surround each emission. Keep `sseOptions` beside decoded
`input`; live keys include decoder policy, while accumulated keys also include retention
and refetch policy. Applications own reconnect and resume controls. Empty live completion
raises `EffectHttpApiQueryEmptyStreamError`; a top-level `undefined` emission becomes `null`.

Raw byte streams, mixed buffered/SSE successes, multipart SSE payloads, and streaming
multipart request alternatives omit the whole endpoint. Empty groups disappear. Consume
unsupported streams through the underlying Effect client.

## Read buffered metadata

Use `metadataOptions` when a read needs decoded data, response status, or raw
string headers. Use `metadataKey(input)` for typed cache access. Its `metadata`
discriminator separates it from ordinary data; a leaf prefix matches both views.
Metadata has no mutation or infinite builders and is absent on multipart and
streaming endpoints.

Fetched envelopes and their copied header records are frozen. The decoded `data`
remains mutable and retains any declared decoded header wrapper. Only an entirely
undefined success becomes `null`. Initial data, hydration, manual writes, and
selected results remain application-owned.

Native `select`, skipping, defaults, and cancellation apply. Global and prefix
`structuralSharing` policies apply to fetched metadata snapshots. Selected results
and later manual writes use an explicit policy passed to `metadataOptions`, or
standard deep sharing when omitted. An inherited sharing callback does not govern
those later values. A fresh-cache hit from `queryClient.query` does not replace an
existing Query's options. Install a changed policy through an observer or an actual
fetch before relying on it for manual writes.

Apply an application disclosure policy before persisting raw headers: their strings
receive no inspection redaction.

## Consume decoded SSE

Keep decoder options beside the request. This function accepts an already acquired
client for the same declaration and returns independent history and latest views:

```ts
import { Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import type { HttpApiClient } from 'effect/http-api'

export const eventsApi = HttpApi.make('events-api').add(
  HttpApiGroup.make('events').add(
    HttpApiEndpoint.get('watch', '/events', {
      query: { channel: Schema.String },
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
    }),
  ),
)

export function httpEventOptions(client: HttpApiClient.ForApi<typeof eventsApi>) {
  const http = createHttpApiQueryUtils(eventsApi, { client, keyPrefix: ['events-app'] })
  const input = { query: { channel: 'news' } }
  const policy = {
    maxChunks: 100,
    refetchMode: 'append' as const,
    sseOptions: { maxEventSize: 1_048_576 },
  }
  return {
    history: http.events.watch.streamedOptions({ input, ...policy }),
    historyKey: http.events.watch.streamedKey(input, policy),
    latest: http.events.watch.liveOptions({ input, sseOptions: policy.sseOptions }),
  }
}
```

The accumulated key includes normalized `maxChunks`, `refetchMode`, and
`sseOptions.maxEventSize`; the live key includes the decoder limit. Its default is
10 MiB per SSE event, distinct from the cache's element bound. Applications own
reconnect, replay, and resume. For refetch visibility and retention, read
[query patterns](query-patterns.md); for request capture, read
[hydration and SSR](hydration-and-ssr.md).

## Multipart mutations

The example declares `users.upload` with a buffered multipart file payload and
numeric `params.id`. Build the multipart fields and files explicitly in `FormData`,
then pass it as `payload` alongside the decoded request containers when calling `mutate`.

The adapter forwards the original `FormData` to the ready client. The decoded success,
callback variables, execution services, and error Cause follow the ordinary mutation
contract. Keep multipart mutation-only endpoints out of `keyEncoders`; encoder entries
are rejected because mutation variables and files never enter query identity.

## Key encoding

The adapter synchronously schema-encodes labelled request parts for default keys. It omits
encoded undefined object members and retains array order and encoded null.
Header names become lowercase; conflicting duplicate header names fail. These
rules apply to default encoding, not custom encoder output.

Configure custom encoders under declaration group and endpoint identifiers,
including top-level groups: `keyEncoders: { groupId: { endpointId: encoder } }`.
The encoder receives the complete decoded request. For endpoints with query support,
provide one when encoding requires services, the request contains explicit redacted values, or the endpoint
declares multiple payload alternatives. Binary query inputs need a JSON-safe projection,
such as an array of bytes.

Return strict synchronous `JsonValue` and preserve body/content-type distinctions
between alternatives, even if two schemas encode to the same scalar. An encoder
supplies identity only; the client still performs request encoding, and the
runner must provide required services. Keep ordinary authentication in client
middleware and use safe identity partitions in the key prefix.

Source: [HTTP factory contract](https://ueberbrot.github.io/effect-api-query/reference/http-factory/).
