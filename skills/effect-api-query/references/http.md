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

The adapter omits an endpoint entirely if it has **any streaming success alternative**
or **any streaming multipart request alternative**. Empty groups disappear. Use the underlying
Effect client directly for these endpoints.

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
