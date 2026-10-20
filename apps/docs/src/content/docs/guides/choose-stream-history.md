---
title: Choose Stream History
description: Choose retained history, transport buffering, and update rates for long-running streams.
---

Choose a cached representation that fits the screen:

| Need | Builder | Retained data |
| --- | --- | --- |
| Every emitted value in order | `streamedOptions` | Unlimited history by default. |
| A recent event window | `streamedOptions` with `maxChunks` | Up to the specified number after publication. |
| Current state | `liveOptions` | The latest emitted value. |

For a long-running event display, choose a finite `maxChunks`. For current progress or a feed of complete state, choose a live query. Unlimited accumulation grows with each emission. Use it for finite histories or workloads that deliberately retain every emission. If history must survive cache eviction or application restarts, persist it outside the query cache.

These choices apply to both RPC streams and supported HTTP SSE endpoints. Live queries normalize successful `undefined` to `null`. Accumulated histories preserve their emitted values.

## Set retention and buffering separately

`maxChunks` limits cached elements after each publication. Seeded or hydrated history can exceed the bound until another publication. One element can contain a large object or array, so the bound does not limit bytes. The cache discards older elements and preserves the remaining order. Use the same retention, refetch, and publication policy when building an exact key and its options.

RPC `rpcOptions.streamBufferSize` controls the ready client's transport buffer before consumption. It does not set cache history or the rate of cache writes. HTTP transport buffering belongs to the ready HTTP API client. Changing a history bound does not slow the producer.

An initial accumulated or live fetch exposes its first value while the stream remains open. An accumulated `replace` refetch publishes its replacement only after successful completion. If the replacement stream stays open indefinitely, the previous history remains visible. See [Stream Snapshots](/effect-api-query/guides/stream-snapshots/) for finite server captures.

## Assess writes and references separately

Accumulated streams build new history arrays without changing previous publications. A history bound limits array length. By default, each consumed value contributes to a cache update. Live queries also accept each value, including repeated values. Native structural sharing can preserve equal data references without suppressing those cache writes.

For JSON-compatible values, TanStack's default structural sharing can reuse unchanged objects and nested values. A moving window changes array positions, so sharing can produce more distinct references. Compare the data shape your application receives before choosing `structuralSharing: false` or a custom native policy.

Cache notifications also include query creation and changes during fetching. Count data writes, data reference changes, and retained elements separately. Framework observer selection and render scheduling affect rendering. Cache notification counts do not count component renders.

If the producer outruns the interface, set a rate or sampling policy in the producer or an application-owned Effect Stream transformation. Sampling intentionally discards values. Retention, transport buffering, and publication rate have separate purposes.

## Batch accumulated publications

Set `publicationBatchSize` on RPC or HTTP SSE `streamedOptions` to publish several events together:

```ts
const history = rpc.diagnostics.stream.streamedOptions({
  maxChunks: 1000,
  publicationBatchSize: 32,
});
```

It accepts a positive safe integer and defaults to one. The first event publishes immediately; later publications append the next batch in order. Completion or failure flushes a partial batch. A `replace` refetch keeps the old history until successful completion, as usual. Cancellation discards unpublished events and follows native cancellation and cache reversion.

Batching counts events and sets no deadline. After the first publication, a slow or paused stream can leave a partial batch unpublished indefinitely. For example, a batch size of 32 leaves the next ten events unpublished until another 22 arrive or the stream ends. Choose one when each event must appear promptly.

Transport consumption continues as the batch fills. The pending batch uses memory alongside cached history. Every event contributes in order, subject to the configured retention bound. If a batch exceeds `maxChunks`, only its newest retained elements remain visible. Earlier publications keep their own arrays. Live queries continue publishing each latest value.

Reuse the options' `queryKey` for exact cache access, or pass the same policy to `streamedKey`. Nondefault batch sizes create separate accumulated cache entries. An explicit one shares the default key. Endpoint and branch prefixes still select every publication policy.
