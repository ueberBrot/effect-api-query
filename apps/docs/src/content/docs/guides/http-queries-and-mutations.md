---
title: HTTP Queries and Mutations
description: Use decoded requests, writes, metadata and SSE views from an existing HttpApi.
---

Use your existing `http` utility tree and QueryClient. The examples below name the declared
request parts and result shape for each endpoint; substitute the corresponding operation
from your API. Import native observers/hooks from TanStack Query when using them.

## Create the utilities

Create the tree in the application client module with your HttpApi and acquired client:

```ts
const http = createHttpApiQueryUtils(api, { client, keyPrefix: ['my-app'] })
```

Import the factory from `effect-api-query`. Keep base URL, middleware and authentication on the
ready client. When execution needs services, supply your application's signal-aware
`runPromiseExit`. The [HTTP Quick Start](/effect-api-query/getting-started/http-quick-start/)
shows factory, read and write setup.

## Fetch a user

For `users.get` declaring an integer `id` param, in a loader or event handler:

```ts
const userOptions = http.users.get.queryOptions({
  input: { params: { id: 1 } },
  staleTime: 30_000,
})

const user = await queryClient.query(userOptions)
```

Pass decoded values in every declared `params`, `query`, `headers`, and `payload` container,
even when its fields are optional. The client encodes them; HTTP builders add no constructor
defaults. An inputless endpoint uses `queryOptions()`.

Pass `userOptions` to a native query hook for observation. `select` changes its result while
`getQueryData(userOptions.queryKey)` still infers the decoded cache value.

## Update with an ETag

Suppose `users.get` supplies an ETag and `users.update` declares `id` params, an `if-match`
header, a `{ name }` payload and its precondition error. In the write handler, read metadata:

```ts
const input = { params: { id: 1 } }
const metadataOptions = http.users.get.metadataOptions({ input })
const current = await queryClient.query(metadataOptions)
const etag = current.headers['etag']
if (etag === undefined) throw new Error('The server supplied no ETag')
```

Cancel affected reads and prepare the mutation with endpoint-prefix invalidation:

```ts
await queryClient.cancelQueries({ queryKey: http.users.get.key() })
const update = new MutationObserver(
  queryClient,
  http.users.update.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: http.users.get.key() }),
  }),
)
```

Execute that write with the ETag unchanged, **including quotes**:

```ts
await update.mutate({
  params: input.params,
  headers: { 'if-match': etag },
  payload: { name: 'Ada' },
})
```

After invalidation, fetch metadata again and use its next ETag before another write:

```ts
const refreshed = await queryClient.query(metadataOptions)
```

The server enforces the precondition; handle a declared failure through the HTTP execution
error. The prefix refreshes both data and metadata entries. Metadata retains decoded success
(including decoded header wrappers), status and copied frozen raw string headers in a separate
cache view. Choose safe headers before persistence or hydration.

[Buffered metadata](/effect-api-query/reference/http-factory/#buffered-metadata) specifies
initial data, selection, immutable snapshots and structural sharing. A fresh imperative cache
hit keeps existing Query options; install a changed policy through an observer or actual fetch
before later manual writes.

## Wait for request input

In a React component, use the exported `skipToken` until the full request exists:

```ts
import { useQuery } from '@tanstack/react-query'
import { skipToken } from 'effect-api-query'

const user = useQuery(
  http.users.get.queryOptions({
    input: userId === undefined ? skipToken : { params: { id: userId } },
    staleTime: 30_000,
    select: (user) => user.name,
  }),
)
```

Skipping keeps caller options and performs no encoding or request. For manual refetch, use
`enabled: false` with complete input. [Conditional Queries](/effect-api-query/guides/conditional-queries/)
covers sentinel, suspense and prefetch restrictions.

## Load pages

For `users.list` declaring `cursor` and `filter` query fields and returning
`{ items, nextCursor }`, build options in the query consumer:

```ts
const filter = 'active'
const pageOptions = http.users.list.infiniteOptions({
  initialPageParam: 0,
  input: (cursor) => ({ query: { cursor, filter } }),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
  select: (data) => data.pages.flatMap((page) => page.items),
})
```

Pass `pageOptions` to the native infinite hook. The initial mapped request determines identity;
keep stable filters in every page and rebuild options when they change. The mapper runs during
key construction and execution, so keep it deterministic and return all declared containers.
`select` changes the observer result; cache data retains `pages` and `pageParams`.
See [HTTP pagination](/effect-api-query/reference/http-factory/#pagination) for skipping,
page inference and execution contracts.

## Create a user and refresh the cache

In the mutation module, prepare the write and refresh its affected branch:

```ts
const createUser = new MutationObserver(
  queryClient,
  http.users.create.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: http.users.key() }),
  }),
)
```

In an event handler, supply this execution's complete decoded request:

```ts
await createUser.mutate({ payload: { name: 'Ada' } })
```

Native `useMutation` accepts the same options. Successful `undefined` query data becomes
`null`; mutation results keep `undefined`. See [Handle Failures](/effect-api-query/guides/handle-failures/#inspect-http-failures).

## Upload a file

In the shared contract module, declare the buffered multipart payload:

```ts
import { Schema } from 'effect'
import { Multipart } from 'effect/http'
import { HttpApiEndpoint, HttpApiSchema } from 'effect/http-api'

const upload = HttpApiEndpoint.post('upload', '/users/:id/files', {
  params: { id: Schema.Int },
  payload: Schema.Struct({ file: Multipart.SingleFileSchema }).pipe(HttpApiSchema.asMultipart()),
  success: Schema.Struct({ name: Schema.String }),
})
```

In the mutation module, use the updated API's utilities. In the upload handler, build `FormData`
explicitly and pass it with all other declared containers:

```ts
const uploadFile = new MutationObserver(
  queryClient,
  http.users.upload.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: http.users.key() }),
  }),
)

const payload = new FormData()
payload.set('file', new Blob(['profile notes'], { type: 'text/plain' }), 'notes.txt')
const uploaded = await uploadFile.mutate({ params: { id: 1 }, payload })
```

The ready client and runner own encoding/middleware; the adapter returns decoded success.
Any buffered multipart alternative makes the whole endpoint mutation-only. Leave it out of
`keyEncoders`: mutation keys contain no variables, so encoder entries are rejected. Streaming
success or streaming multipart alternatives omit the whole endpoint.
The [multipart runtime recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/http-multipart.test.ts)
contains the complete contract and execution.

## Retain SSE events

For one `HttpApiSchema.StreamSse` success declaring a `channel` query field, build observation
options in the query consumer:

```ts
const events = http.events.watch.streamedOptions({
  input: { query: { channel: 'news' } },
  maxChunks: 100,
  refetchMode: 'reset',
  sseOptions: { maxEventSize: 1024 * 1024 },
})
```

Pass `events` to the framework query hook or `QueryObserver`. The first emission is successful
data while fetching continues. `maxChunks` bounds cached elements; omit it for unlimited
history. It does not bound transport buffering. `reset`, `append` and `replace` choose refetch
history; an open `replace` keeps old data until completion. Accumulated elements retain
`undefined` and decoded header wrappers.

`sseOptions.maxEventSize` bounds pending parser text in code units (default 10 MiB).
Decoder and history policy affect exact identity; use the same policy with `streamedKey`, or
reuse `events.queryKey`. Declared resume headers belong in `input.headers`. Reconnection,
`Sse.Retry` and resume policy remain application-owned. See
[HTTP streams](/effect-api-query/reference/http-factory/#accumulated-sse-options) for full policies,
failures and omitted response shapes.

## Keep the latest SSE value

For snapshot-like emissions, in the same query consumer:

```ts
const latest = http.events.watch.liveOptions({
  input: { query: { channel: 'news' } },
  sseOptions: { maxEventSize: 1024 * 1024 },
})
```

Pass `latest` to a native query hook or observer. Each emission replaces cached data; completion
preserves it. Top-level `undefined` becomes `null`; a decoded header wrapper keeps its body.
Empty completion raises `EffectHttpApiQueryEmptyStreamError`. Transport/decoding/event failures
and independent interruption preserve their full Cause.

Use `latest.queryKey` or `liveKey(input, { sseOptions })` for exact access. Live views accept no
history bound/refetch mode and remain separate from accumulated views. Both support skipped
input and endpoint-prefix filtering. Unsubscribe, cancel and drain local work before disposal;
other observers retain their subscriptions. See [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/).

## Keep cache entries separate

In a cache callback or event handler:

```ts
const key = http.users.get.queryKey({ params: { id: 1 } })
const cachedUser = queryClient.getQueryData(key)
await queryClient.invalidateQueries({ queryKey: http.users.key() })
```

Include safe user/tenant identity in `keyPrefix` when middleware changes results. Keep credentials
out of keys; use [custom encoders](/effect-api-query/guides/custom-key-encoders/#http-requests)
when default request encoding cannot supply safe JSON identity.

The [running React HTTP panel](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/components/sections/http-section.tsx)
shows buffered users and diagnostics. Advanced type recipes are in
[http-contract.ts](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/http-contract.ts) and
[http-stream-contract.ts](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/http-stream-contract.ts);
[metadata runtime recipes](https://github.com/ueberBrot/effect-api-query/blob/main/tests/http-cached-views.test.ts)
cover metadata behavior.
