---
title: Choose Stream History
description: Choose retained history, transport buffering, and update rates for long-running streams.
---

Choose a cached representation that fits the screen:

| Need | Builder | Retained data |
| --- | --- | --- |
| Every emitted value in order | `streamedOptions` with `maxChunks: 'unbounded'` | Every event until cache eviction. |
| A recent event window | `streamedOptions` with `maxChunks` | Up to the specified number after publication. |
| Current state | `liveOptions` | The latest emitted value. |

For a long-running event display, choose a finite `maxChunks`. For current progress or a feed of complete state, choose a live query. Unlimited accumulation grows with each emission. Use it for finite histories or workloads that deliberately retain every emission. If history must survive cache eviction or application restarts, persist it outside the query cache.

These choices apply to both RPC streams and supported HTTP SSE endpoints. Live queries normalize successful `undefined` to `null`. Accumulated histories preserve their emitted values.

## Set retention and buffering separately

A finite `maxChunks` limits cached elements after each publication. Supply a positive safe integer or choose `"unbounded"` explicitly. Use `configureUtils` with `streamed.policy` to share this choice across a tree, branch, or leaf. Seeded or hydrated history can exceed the bound until another publication. One element can contain a large object or array, so the bound does not limit bytes. The cache discards older elements and preserves the remaining order. Use the same retention, refetch, and publication policy when building an exact key and its options.

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

By default, batching counts events without a deadline. After the first publication, a slow or paused stream can leave a partial batch unpublished indefinitely. For example, a batch size of 32 leaves the next ten events unpublished until another 22 arrive or the stream ends. Choose a batch size of one when each event must appear promptly, or set a publication deadline as shown below.

Transport consumption continues as the batch fills. The pending batch uses memory alongside cached history. Every event contributes in order, subject to the configured retention bound. If a batch exceeds `maxChunks`, only its newest retained elements remain visible. Earlier publications keep their own arrays. Live queries continue publishing each latest value.

Reuse the options' `queryKey` for exact cache access, or pass the same policy to `streamedKey`. Nondefault batch sizes create separate accumulated cache entries. An explicit one shares the default key. Endpoint and branch prefixes still select every publication policy.

## Flush a quiet publication batch

For uneven event traffic, combine a count limit with a deadline:

```ts
const options = rpc.diagnostics.stream.streamedOptions({
  maxChunks: 100,
  publicationBatchSize: 10,
  publicationMaxWaitMs: 50,
});
```

The first event publishes immediately. Later events publish in ordered batches when the count reaches ten or the oldest buffered event has waited fifty milliseconds. Omit the deadline to keep count-only behavior. Browser scheduling can delay timers; this is not a real-time guarantee.

## Consume events without cached history

Use `consumeEvents` for notifications or invalidation signals that do not need a query cache entry:

```ts
import { consumeEvents } from "@ueberbrot/effect-api-query";
import { Effect, Stream } from "effect";

const consumption = consumeEvents(Stream.make(1, 2, 3), {
  onStart: Effect.log("Starting event consumption"),
  onEvent: (event) => Effect.log(event),
  onExit: (exit) => Effect.log(exit._tag),
});
```

Pass a native decoded stream from your ready client in an application. The returned Effect starts only when run. Event callbacks run sequentially and apply backpressure. A callback failure stops consumption and remains in the error channel. `onExit` runs after stream cleanup, including failure and interruption; its finalization must finish before the Effect settles. `onStart` signals local startup, not transport connection. The helper stores no history and owns no runtime or cache. Run it in your application's Scope, interrupt it before disposing resources, and apply `recoverStream` when replay and reconnection are needed.
