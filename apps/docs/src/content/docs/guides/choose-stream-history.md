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

These choices apply to both RPC streams and supported HTTP SSE and NDJSON endpoints. Live queries normalize successful `undefined` to `null`. Accumulated histories preserve their emitted values.

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

Set `publicationBatchSize` on RPC or HTTP SSE/NDJSON `streamedOptions` to publish several events together:

```ts
const history = rpc.diagnostics.stream.streamedOptions({
  maxChunks: 1000,
  publicationBatchSize: 32,
});
```

It accepts a positive safe integer and defaults to one. The first event publishes immediately; later publications append the next batch in order. Completion or failure flushes a partial batch. A `replace` refetch keeps the old history until successful completion, as usual. Cancellation discards unpublished events and follows native cancellation and cache reversion.

By default, batching counts events without a deadline. After the first publication, a slow or paused stream can leave a partial batch unpublished indefinitely. For example, a batch size of 32 leaves the next ten events unpublished until another 22 arrive or the stream ends. Choose a batch size of one when each event must appear promptly, or set a publication deadline as shown below.

Transport consumption continues as the batch fills. The pending batch uses memory alongside cached history. Every event contributes in order, subject to the configured retention bound. If a batch exceeds `maxChunks`, only its newest retained elements remain visible. Earlier publications keep their own arrays. Live queries publish each latest value unless coalescing is explicitly enabled.

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

## Coalesce complete live snapshots

Use `liveOptions({ coalesceMs: 50 })` on RPC or HTTP SSE/NDJSON when every emission is complete state and intermediate snapshots may be skipped. Omit it to publish every value. Choose an integer from 1 to 2,147,483,647 milliseconds.

The first value of each fetch publishes immediately. The next value starts a deadline; subsequent values replace the single pending snapshot without moving that deadline. When the deadline timer runs, publish the latest pending value even if the next pull is blocked. Event-loop scheduling can delay publication. A later value starts another deadline. Completion or failure flushes the pending value before settling; failures retain their full Cause. Empty completion remains an empty-live-stream error. Successful `undefined` becomes `null`.

Refetch resets the view and starts a fresh cycle. Cancellation drops pending values, clears the timer and closes the iterator; native cancellation/reversion still applies. Native cancellation can settle before local finalizers finish. This adds no cleanup timeout or remote acknowledgement.

Share defaults with `configureUtils(leaf, { live: { policy: { coalesceMs: 50 } } })`. Configured keys inherit the same policy as options. Direct exact keys take the same policy: `liveKey(input, { coalesceMs: 50 })`, or `liveKey({ coalesceMs: 50 })` for inputless operations. Explicit deadlines have separate cache identity. On an unconfigured leaf, omitted and `undefined` preserve the default key. A local `coalesceMs: undefined` clears an inherited coalescing policy; omitting the local option inherits it. HTTP SSE keys also include decoder policy. Keep `sseOptions` local and pass the same options to the configured key builder. Prefer the options' `queryKey` for cache access.

Raw `consumeEvents` still processes every event sequentially. For deltas and ordered history, use accumulated retention and publication batches/deadlines, which preserve accepted event order. Treat all published values as immutable.

RPC live key types include an optional trailing policy slot even when coalescing is omitted. Default runtime keys remain unchanged, but the wider type cannot be assigned to the previous exact-length tuple. This is a breaking public type change under the [compatibility policy](/effect-api-query/getting-started/compatibility-and-stability/). Use generated keys or the options' `queryKey` directly for cache access; remove old exact-length annotations. Literal operation paths and data/error tags remain precise.
