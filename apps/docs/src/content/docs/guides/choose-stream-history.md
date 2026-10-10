---
title: Choose Stream History
description: Choose retained history, transport buffering, and update rates for long-running streams.
---

Choose the cached representation from what the screen needs:

| Need                         | Builder                            | Retained data                                 |
| ---------------------------- | ---------------------------------- | --------------------------------------------- |
| Every emitted value in order | `streamedOptions`                  | Unlimited history by default.                 |
| A recent event window        | `streamedOptions` with `maxChunks` | Up to the specified number after an emission. |
| Current state                | `liveOptions`                      | The latest emitted value.                     |

For a long-running event display, choose a finite `maxChunks`. For current progress or a full-state
feed, choose a live query. Unlimited accumulation grows with the number of emissions; it suits
finite histories or workloads where that growth is deliberate. Persist durable history outside
the query cache when it must survive cache eviction or application restarts.

These choices apply to both RPC streams and supported HTTP SSE endpoints. Live queries normalize
successful `undefined` to `null`; accumulated histories preserve their emitted values.

## Set retention and buffering separately

`maxChunks` limits the number of cached elements after each new emission. Seeded or hydrated history
can exceed the bound until another element arrives. One element can contain a large object or array,
so this bound does not limit bytes. It discards older elements while preserving the remaining order.
Use the same retention and refetch policy when building an exact key and its options.

RPC `rpcOptions.streamBufferSize` controls the ready client's transport buffer before consumption.
It does not set cache history or the rate of cache writes. HTTP transport buffering belongs to
the ready HTTP API client. Changing a history bound does not slow the producer.

An initial accumulated or live fetch exposes its first value while the stream remains open.
An accumulated `replace` refetch publishes its replacement only after successful completion;
an indefinitely open replacement therefore keeps showing the previous history. See
[Stream Snapshots](/effect-api-query/guides/stream-snapshots/) for finite server captures.

## Assess writes and references separately

Accumulated streams build new history arrays without mutating previous publications. A history
bound limits their length; each consumed value still contributes to cache updates. Live queries
also accept each value, including repeated values. Native structural sharing can preserve equal
data references without suppressing those cache writes.

For JSON-compatible values, TanStack's default structural sharing can reuse unchanged objects and
nested values. A moving window changes array positions, so sharing can also produce additional
distinct references. Compare the data shape your application receives before choosing
`structuralSharing: false` or a custom native policy.

Cache notifications also include query creation and fetch lifecycle changes. Count data writes,
data reference changes, and retained elements separately. Framework observer selection and
render scheduling add their own behavior; cache notification counts do not count component renders.

If the producer outruns the interface, set an explicit rate or sampling policy in the producer or
an application-owned Effect Stream transformation. Sampling intentionally discards values.
Retention and transport buffering serve different purposes from publication rate.

## Repeat the repository baseline

From a repository checkout with its dependencies available, run:

```sh
STREAM_MEASURE=/tmp/stream-baseline.json vp run --no-cache test tests/create-rpc-query-utils-stream-baseline.test.ts
```

The command replaces the chosen JSON file. It compares 64 numeric or object emissions across
unlimited history, windows of four and sixteen elements, and live values, with native structural
sharing enabled and disabled. Each case uses a fresh QueryClient and a finite in-memory ready
RPC client, with no framework observers.

The report records dependency versions, source and workload fingerprints, cache notifications,
data writes, changed references, and retained sequences. It separates the stream's manual cache
writes from the final successful fetch write. Array-slot and object-reference counts
describe values observed at the cache boundary. They do not measure total allocation, heap size,
garbage collection, network throughput, or browser rendering time. Use the same workload and
toolchain when comparing changes, then measure any rendering concern in the application that has it.
