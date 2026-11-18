---
title: Choose Stream History
description: Choose retained history, transport buffering, and update rates for long-running streams.
---

Decide which values the screen needs to keep.

| Need | Builder | Retained data |
| --- | --- | --- |
| Every emitted value in order | `streamedOptions` with `maxChunks: 'unbounded'` | Every event until cache eviction. |
| A recent event window | `streamedOptions` with `maxChunks` | Up to the specified number after publication. |
| Current state | `liveOptions` | The latest emitted value. |

For an event feed, keep a finite number of values. For current progress or complete state, use a live query. Unlimited history grows with every emission. If data must survive eviction or a restart, store it outside the query cache.

Both RPC and supported HTTP SSE and NDJSON endpoints offer these views. Live queries convert `undefined` to `null`. Histories keep the original emissions.

## Set retention and buffering separately

Set `maxChunks` to a positive safe integer or choose `"unbounded"`. You can share this choice with `configureUtils` under `streamed.policy`. After each publication, the cache keeps the newest elements in order. Seeded or hydrated history can exceed the bound until then. The bound counts elements, so a large object can still use substantial memory. Use the same policies for exact keys and options.

RPC `rpcOptions.streamBufferSize` controls the ready client's queue before consumption. HTTP buffering belongs to the HTTP client. Configure cache retention and publication separately. Changing the history bound leaves the producer's rate unchanged.

An initial fetch exposes its first value while the stream stays open. An accumulated `replace` refetch keeps the previous history until successful completion. For a finite server capture, see [stream snapshots](/effect-api-query/guides/stream-snapshots/).

## Assess writes and references separately

Accumulated streams publish new arrays and leave previous arrays intact. By default, each value contributes to a cache write, even if it repeats. Structural sharing can keep an equal reference while Query still publishes state changes.

TanStack can reuse unchanged JSON-compatible objects and nested values. A moving window shifts array positions, which can reduce reuse. Measure your data before disabling sharing or supplying a custom policy.

Count data writes, reference changes, and retained elements separately. Query creation and fetching also notify the cache. To measure renders, observe the framework because selection and scheduling affect when a component updates.

If the screen cannot keep up, set a rate or sampling policy in the producer or an Effect Stream transformation. Sampling drops values. Publication batches keep accepted values in order.

## Batch accumulated publications

Set `publicationBatchSize` to group events in an accumulated RPC, SSE, or NDJSON query.

```ts
const history = rpc.diagnostics.stream.streamedOptions({
  maxChunks: 1000,
  publicationBatchSize: 32,
});
```

The size must be a positive safe integer and defaults to one. The first event publishes immediately. Later events publish in order. Completion or failure flushes a partial batch. A `replace` refetch publishes only after success. Cancellation discards pending values and follows TanStack's cache reversion.

With count-only batching, a quiet feed can leave values unpublished. For example, size 32 leaves the next ten events pending until 22 more arrive or the stream ends. Use size one for immediate updates, or add a deadline.

Transport consumption continues while the batch fills. The pending batch uses memory in addition to the history. If the batch exceeds `maxChunks`, the cache keeps only the newest values in the bound. Earlier publications keep their arrays.

Use the options' `queryKey` or pass the same policy to `streamedKey`. A nondefault batch size has its own key. Explicit size one shares the default key. Endpoint and branch prefixes match every size.

## Flush a quiet publication batch

Add a deadline if event traffic is uneven.

```ts
const options = rpc.diagnostics.stream.streamedOptions({
  maxChunks: 100,
  publicationBatchSize: 10,
  publicationMaxWaitMs: 50,
});
```

After the first event, publish when ten events arrive or the oldest pending event reaches 50 milliseconds. Omit the deadline for count-only batching. Browser scheduling can delay the timer.

## Consume events without cached history

Use `consumeEvents` to handle notifications or invalidation without storing a history.

```ts
import { consumeEvents } from "@ueberbrot/effect-api-query";
import { Effect, Stream } from "effect";

const consumption = consumeEvents(Stream.make(1, 2, 3), {
  onStart: Effect.log("Starting event consumption"),
  onEvent: (event) => Effect.log(event),
  onExit: (exit) => Effect.log(exit._tag),
});
```

Pass a decoded stream from your ready client and run the returned Effect inside your app's Scope. The helper calls event handlers in order and waits for each one. A failed handler stops consumption and adds its failure to the Effect result. `onStart` signals local startup. `onExit` runs after cleanup and must finish before the Effect settles. Interrupt it before disposal. Use [recovery](/effect-api-query/guides/reconnect-streams/) for replay.

## Coalesce complete live snapshots

Use `liveOptions({ coalesceMs: 50 })` when each emission contains complete state and you can skip intermediate snapshots. Set a whole number from 1 to 2,147,483,647 milliseconds. Omit the setting to publish every value.

Each fetch publishes the first value immediately. The next value starts a timer. New arrivals replace the pending value without extending the deadline. The timer publishes the latest pending value even if the next pull is blocked. The event loop can delay the timer. Completion or failure publishes the pending value before settling. Empty completion still fails. Successful `undefined` becomes `null`.

A refetch starts a new cycle. Cancellation drops pending values, clears the timer, and closes the iterator. Native cache reversion still applies. Wait for [local cleanup](/effect-api-query/guides/cancellation/#release-resources-after-local-cleanup) before releasing shared resources.

Set a default with `configureUtils(leaf, { live: { policy: { coalesceMs: 50 } } })`. Omit the local setting to inherit it. Pass `coalesceMs: undefined` to clear it. For exact access, reuse `queryKey` or pass the same policy to `liveKey(input, { coalesceMs: 50 })`. If the operation takes no input, use `liveKey({ coalesceMs: 50 })`. Explicit deadlines have distinct keys. For HTTP SSE, also pass the same local `sseOptions`.

For events that represent changes, use accumulated history or `consumeEvents` to preserve order. Keep published values unchanged.
