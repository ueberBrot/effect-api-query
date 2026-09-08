# HTTP setup and rules

Use the application's existing HttpApi declaration and ready HttpApiClient. This
standalone example expects a server at `http://localhost:3000` implementing the
same declaration.

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { ManagedRuntime, Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import { FetchHttpClient } from 'effect/unstable/http'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

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

Provide the declared `params`, `query`, `headers`, and `payload` containers in
their decoded types. For a `Schema.FiniteFromString` field, pass a number; the
client performs wire encoding. HTTP inputs receive no RPC constructor defaults.
A declared container remains required even if all fields inside it are optional:
use `{ query: {} }` for an empty declared query container.

Mutation variables use that same complete request shape. The adapter forces
decoded-only responses; raw-response controls are not part of the input. Text,
binary responses, and declared response-header wrappers keep their decoded types.

An endpoint with **any streaming success alternative** or **any multipart request
alternative** is omitted entirely. Empty groups disappear. Use the underlying
Effect client for these endpoints instead of inventing missing utility builders.

## Key encoding

Default keys schema-encode labelled request parts synchronously. Encoded undefined
object members are omitted, while array order and encoded null are retained.
Header names become lowercase; conflicting duplicate header names fail. These
rules apply to default encoding, not custom encoder output.

Configure custom encoders under declaration group and endpoint identifiers,
including top-level groups: `keyEncoders: { groupId: { endpointId: encoder } }`.
The encoder receives the complete decoded request. Provide one for encoding
services, explicit redacted values, or multiple payload alternatives. Binary
inputs need a JSON-safe projection, such as an array of bytes.

Return strict synchronous `JsonValue` and preserve body/content-type distinctions
between alternatives, even if two schemas encode to the same scalar. An encoder
supplies identity only; the client still performs request encoding, and the
runner must provide required services. Keep ordinary authentication in client
middleware and use safe identity partitions in the key prefix.

Source: [HTTP factory contract](https://ueberbrot.github.io/effect-api-query/reference/http-factory/).
