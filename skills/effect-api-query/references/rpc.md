# RPC setup and rules

Use the application's existing RPC group and protocol. The standalone example
below illustrates acquisition and cleanup against a server at
`http://localhost:3000/rpc` implementing the same contract.

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { FetchHttpClient } from 'effect/unstable/http'
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from 'effect/unstable/rpc'

const users = RpcGroup.make(
  Rpc.make('users.get', {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  }),
  Rpc.make('users.rename', {
    payload: { id: Schema.Int, name: Schema.String },
    success: Schema.Void,
  }),
)

const protocol = RpcClient.layerProtocolHttp({ url: 'http://localhost:3000/rpc' }).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer),
)
const scope = await Effect.runPromise(Scope.make())
const queryClient = new QueryClient()

try {
  const client = await Effect.runPromise(
    RpcClient.make(users, { flatten: true }).pipe(Effect.provide(protocol), Scope.provide(scope)),
  )
  const rpc = createRpcQueryUtils(users, { client, keyPrefix: ['users-app'] })
  const input = { id: 1 }
  await queryClient.query(rpc.users.get.queryOptions({ input, staleTime: 30_000 }))
  const cached = queryClient.getQueryData(rpc.users.get.queryKey(input))
  console.log(cached?.name)

  const rename = new MutationObserver(
    queryClient,
    rpc.users.rename.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: rpc.users.key() })
      },
    }),
  )
  await rename.mutate({ id: 1, name: 'Ada' })
} finally {
  try {
    await queryClient.cancelQueries()
  } finally {
    queryClient.clear()
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
}
```

## Tree and payload semantics

Pass a ready **flat** client: `RpcClient.make(group, { flatten: true })`. Dotted
RPC tags become nested paths: `users.get` becomes `rpc.users.get`. A tag segment
containing a hyphen needs bracket access. Path collisions and reserved builder
names fail at factory construction.

RPC builders accept payload constructor input. Query preparation applies Schema
constructor defaults before deriving canonical identity. With a constructor default of
`locale: 'en'`, `{ id: 1 }` and `{ id: 1, locale: 'en' }` address the same query.
Queries require query-stable construction: the ready client must be able to
reconstruct the normalized payload without changing its encoded meaning. Use
standard struct-shaped payloads and materialized defaults. If reconstruction
changes existing values, expose a stable query-facing RPC.

Mutations pass constructor input directly to the ready client for construction
at execution time. Their keys contain no variables and invoke no key encoder;
constructor-sensitive Schemas remain usable for mutations.

## Request-local options

Pass `rpcOptions` through option builders to set `headers` and `context` for that
operation. Stream builders additionally accept `streamBufferSize`. These options
are fixed for the builder result, including retries and all infinite pages. They
are removed from the returned TanStack options and do not contribute to keys.

Use the payload or a safe key prefix for any identity carried by these options.
`streamBufferSize` controls the client's stream buffer; `maxChunks` controls the
accumulated cache. Unary `discard` and stream `asQueue` controls are unavailable.

## Custom key encoders

Configure `keyEncoders` by the original literal RPC tag, such as `'secrets.read'`.
An encoder receives the normalized payload after constructor defaults. Provide
one when payload encoding needs services or contains explicit redacted values.

Return a synchronous strict `JsonValue`: finite numbers, strings, booleans,
null, dense arrays, and plain objects with defined JSON values. Default RPC
encoding must also produce strict JSON. Dates and binary values need an encoding
or projection; undefined entries, cycles, and unsafe property names fail.

Preserve every distinction that changes results, using safe identifiers for
secrets. Encoders affect query identity only; they leave execution input and
service requirements unchanged.

Source: [RPC factory and builders](https://ueberbrot.github.io/effect-api-query/reference/generated-builders/).
