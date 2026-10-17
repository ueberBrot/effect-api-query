# RPC setup and rules

Use the application's existing RPC group and protocol. This standalone example
acquires and cleans up a client for a server at `http://localhost:3000/rpc`.
The server must implement the same contract.

```ts
import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { FetchHttpClient } from 'effect/http'
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from 'effect/rpc'

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

Pass a ready flat client: `RpcClient.make(group, { flatten: true })`. Dotted RPC
tags become nested paths. For example, `users.get` becomes `rpc.users.get`.
If a tag segment contains a hyphen, use bracket access. The factory rejects path
collisions and reserved builder names during construction.

RPC builders accept payload constructor input. Query preparation applies Schema
constructor defaults, then derives canonical identity. With a constructor default
of `locale: 'en'`, `{ id: 1 }` and `{ id: 1, locale: 'en' }` address the same query.
Queries require query-stable payload construction. The ready client must reconstruct
the normalized payload without changing its encoded meaning. Use standard
struct-shaped payloads and materialized defaults. If reconstruction changes existing
values, expose a stable query-facing RPC.

Mutations pass constructor input directly to the ready client, which constructs
the payload at execution time. Mutation keys contain no variables and invoke no
key encoder. Mutations can use constructor-sensitive Schemas.

## Request-local options

To set an operation's `headers` and `context`, pass `rpcOptions` through its option
builder. Stream builders also accept `streamBufferSize`. These options stay fixed
for the builder result, including retries and all infinite pages. The adapter
removes them from the returned TanStack options. They do not contribute to keys.

If these options carry identity, include that identity in the payload or a safe
key prefix. `streamBufferSize` controls the client's stream buffer. `maxChunks`
controls the accumulated cache. Unary `discard` and stream `asQueue` controls are
unavailable.

`maxChunks` bounds cached history after emissions. It does not resize the transport queue.

## Custom key encoders

Index `keyEncoders` by the original literal RPC tag, such as `'secrets.read'`.
An encoder receives the normalized payload after constructor defaults apply. If
payload encoding needs services, contains explicit redacted values, or uses opaque
encoding middleware, provide an encoder. Runtime inspection treats middleware
conservatively, including synchronous service-free middleware.

Return a synchronous strict `JsonValue`. It can contain finite numbers, strings,
booleans, null, dense arrays, and plain objects with defined JSON values. Default
RPC encoding must also produce strict JSON. Dates and binary values need an
encoding or projection. Undefined entries, cycles, and unsafe property names fail.

Preserve every distinction that changes results. For secrets, use safe identifiers.
Encoders affect only query identity. Execution input and service requirements stay
unchanged.

Source: [RPC factory and builders](https://ueberbrot.github.io/effect-api-query/reference/generated-builders/).
