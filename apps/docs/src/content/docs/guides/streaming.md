---
title: Streaming
description: Cache accumulated or latest values from RPC streams and HTTP SSE.
---

Streaming leaves provide two views. An accumulated streamed query caches emissions in order.
A live query caches the latest value. Use ordinary query hooks or `QueryObserver` for both.
Start with a ready [RPC](/effect-api-query/getting-started/quick-start/) or
[HTTP](/effect-api-query/getting-started/http-quick-start/) utility tree.
Here, `diagnostics.stream` is an inputless RPC emitting strings, and `events.watch` is an HTTP SSE
endpoint declaring `query.channel` and emitting strings.

## Accumulate values

Choose a finite history for a long-running feed:

```ts
const history = rpc.diagnostics.stream.streamedOptions({
  maxChunks: 100,
  refetchMode: 'reset',
})
```

HTTP SSE supports the same history controls and a separate decoder limit:

```ts
const sseHistory = http.events.watch.streamedOptions({
  input: { query: { channel: 'news' } },
  maxChunks: 100,
  sseOptions: { maxEventSize: 1024 * 1024 },
})
```

The first emission makes the query successful while fetching continues. `maxChunks` bounds
cached elements after each emission. If you omit it, history is unlimited. It does not bound bytes
or transport buffering.

Refetch mode `reset` starts a new history, `append` adds to it, and `replace`
keeps the old history until successful completion. An indefinitely open replacement keeps
showing that old history. Accumulated streams can succeed without emissions.

## Keep the latest value

Choose live options for current state:

```ts
const latest = rpc.diagnostics.stream.liveOptions()
const latestSse = http.events.watch.liveOptions({
  input: { query: { channel: 'news' } },
  sseOptions: { maxEventSize: 1024 * 1024 },
})
```

Each emission replaces cached data. Completion preserves that data. Live queries convert top-level
`undefined` to `null`, while accumulated elements retain `undefined`. Empty live completion
raises the adapter's empty-stream error. Live options accept neither `maxChunks` nor `refetchMode`.

## Address and stop a view

For exact cache access, reuse the options' `queryKey`. Accumulated history policies and HTTP decoder
policies affect identity. Live and accumulated views remain separate. Endpoint prefixes match
all their views.

Cancellation closes the stream iterator. Your application owns reconnection, resume policy,
and client lifetime. HTTP `sseOptions.maxEventSize` bounds pending parser text in JavaScript string
code units. Its default is 10 × 1024 × 1024 code units. Put declared resume headers in `input.headers`.

See [Choose Stream History](/effect-api-query/guides/choose-stream-history/) for retention and
buffering, [Stream Snapshots](/effect-api-query/guides/stream-snapshots/) for finite server captures,
and [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for cleanup ownership.
