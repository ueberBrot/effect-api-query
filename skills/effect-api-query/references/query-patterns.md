# Conditional reads, pages, and streams

## Reuse inferred operation types

To infer operation types, import helpers from `@ueberbrot/effect-api-query` and apply them to a utility leaf:

| Helper | Representation |
| --- | --- |
| `InferInput<typeof rpc.users.read>` | RPC payload constructor input, including omitted constructor defaults |
| `InferInput<typeof http.users.read>` | Decoded HTTP request containers, with `FormData` for multipart payloads |
| `InferQueryData<typeof rpc.users.read>` | Cached ordinary query data, before `select` |
| `InferQueryData<typeof http.users.read, 'metadata'>` | Decoded data, status, and copied raw headers |
| `InferQueryData<typeof rpc.events.watch, 'streamed'>` | Ordered decoded stream elements |
| `InferQueryData<typeof rpc.events.watch, 'live'>` | Latest normalized query data |
| `InferQueryError<typeof rpc.users.read>` | Error type carried by the concrete query key |
| `InferMutationData<typeof rpc.users.write>` | Successful mutation value, preserving `undefined` |
| `InferMutationError<typeof rpc.users.write>` | Buffered mutation execution error type |

To infer `InfiniteData` with an unknown page-parameter type, specify `'infinite'`. If the mapper establishes a more precise page-parameter type, use the actual options' tagged key. Query and live data normalize `undefined` to `null`. Accumulated elements and mutation data retain it.

`InferQueryError` accepts the same view parameter as `InferQueryData`. Choose a view that the leaf supports. Stream leaves require an explicit `'live'` or `'streamed'` view. Branches and unsupported default views infer `never`. These types describe the contract. At runtime, runner rejections still pass through unchanged.

For the complete contract for inputs, supported views, and cache representations, read [Type inference](https://ueberbrot.github.io/effect-api-query/reference/type-inference/).

## Conditional reads with React Query

If required input is unavailable, use `input: skipToken`. `enabled: false` still constructs a concrete key and requires valid input. If you have valid input and intend to execute through manual refetch, use `enabled: false`.

The following example exports a hook factory for an application-owned ready RPC client. During application setup, call the factory. Use its returned hook in components under the application's `QueryClientProvider`.

```ts
import { useQuery } from "@tanstack/react-query";
import { createRpcQueryUtils, skipToken } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup, type RpcClient } from "effect/rpc";

export const users = RpcGroup.make(
  Rpc.make("users.get", {
    payload: { id: Schema.Int },
    success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
  })
);

export function makeUseUser(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof users>>
) {
  const rpc = createRpcQueryUtils(users, { client, keyPrefix: ["users-app"] });
  return function useUser(id: number | undefined) {
    return useQuery(
      rpc.users.get.queryOptions({
        input: id === undefined ? skipToken : { id },
        staleTime: 30_000,
      })
    );
  };
}
```

HTTP uses the same conditional pattern with decoded request input. Unary, metadata, streamed, and live builders accept `input: skipToken` in the options object and preserve caller options. Inputless operations, key builders, and mutations do not accept it. Skipped options cannot execute through manual refetch. They are unsuitable for suspense or prefetch-only hooks.

## Infinite queries

Map each page parameter to a complete request. The initial mapped request sets cache identity. Include stable filters in that request and every page. Keep the mapper deterministic because it runs during key construction and again during execution.

```ts
import { QueryClient } from "@tanstack/query-core";
import { createRpcQueryUtils } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup, type RpcClient } from "effect/rpc";

export const catalog = RpcGroup.make(
  Rpc.make("items.page", {
    payload: { cursor: Schema.Int, category: Schema.String },
    success: Schema.Struct({
      items: Schema.Array(Schema.String),
      nextCursor: Schema.NullOr(Schema.Int),
    }),
  })
);

export async function loadPages(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof catalog>>,
  queryClient: QueryClient
) {
  const rpc = createRpcQueryUtils(catalog, {
    client,
    keyPrefix: ["catalog-app"],
  });
  return queryClient.infiniteQuery(
    rpc.items.page.infiniteOptions({
      initialPageParam: 0,
      input: (cursor) => ({ cursor, category: "books" }),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    })
  );
}
```

For interactive pagination, pass the same options to `useInfiniteQuery`. The HTTP input mapper returns decoded request parts, such as `{ query: { cursor, category: 'books' } }`. For cache access, use `infiniteKey` with the complete initial input. Infinite data and ordinary query data have different keys and shapes. To pause an input-bearing infinite query, put `input: skipToken` inside the options object. Do not return the sentinel from a mapper.

## RPC streams

```ts
import { createRpcQueryUtils } from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup, type RpcClient } from "effect/rpc";

export const events = RpcGroup.make(
  Rpc.make("events.watch", {
    payload: { channel: Schema.String },
    success: Schema.String,
    stream: true,
  })
);

export function eventOptions(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof events>>
) {
  const rpc = createRpcQueryUtils(events, {
    client,
    keyPrefix: ["events-app"],
  });
  const input = { channel: "news" };
  const policy = { maxChunks: 100, refetchMode: "append" as const };
  return {
    history: rpc.events.watch.streamedOptions({
      input,
      ...policy,
    }),
    historyKey: rpc.events.watch.streamedKey(input, policy),
    latest: rpc.events.watch.liveOptions({ input }),
  };
}
```

Pass either result to `useQuery` or a query observer. The history and latest views have distinct cache entries. Observing both starts independent executions.

Accumulated queries retain emitted elements in order. `maxChunks` is a positive safe integer that limits element count. It does not limit bytes. Omitting it leaves history unbounded. Both `maxChunks` and `refetchMode` contribute to normalized cache identity. Omitted policy and explicit unlimited/reset policy share an identity. Different bounds or refetch modes use different entries.

Use `streamedKey(input, policy)` or the matching options' `queryKey`. Inputless operations take the policy first. HTTP accumulated and live views also include SSE decoder policy.

The refetch modes control how the next execution updates history:

- `reset` (default) clears data and returns to pending when refetch starts.
- `append` adds new emissions to the cached history.
- `replace` keeps cached history until the refetch stream completes, then replaces it. For this policy, use a stream that completes.

Set `publicationBatchSize` to a positive safe integer to publish an accumulated history in count-based batches. The first event publishes immediately. Later batches preserve every event in order; completion or failure flushes a pending tail, while cancellation discards it. A partial batch on an open feed can wait indefinitely. The default is `1`; nondefault values participate in history key identity. `replace` still waits for successful completion. Batching controls publication, while `maxChunks` controls retention and transport buffering remains separate.

Live queries cache only the latest value. They accept no history or publication batch option. Without cached data, an empty accumulated stream resolves to `[]`. An empty append refetch preserves existing history. Empty reset and replace refetches finish with `[]`. Empty live completion raises `EffectRpcQueryEmptyStreamError`.

Live queries normalize each emitted `undefined` to `null`, including emissions after a defined value. Live keys, selectors, and initial data use the normalized type. Accumulated chunks retain their original values, including `undefined`.

On an initial fetch, both views become successful after the first emission and keep fetching until completion. Ordinary-query cancellation closes the iterator and interrupts its Effect resources. Native cancellation can settle before local finalizers finish. For the native Suspense cancellation limitation, read [frameworks and hosts](frameworks-and-hosts.md).

An awaited QueryClient call waits for stream completion. Hooks and observers see intermediate values. For SSR, read [hydration and SSR](hydration-and-ssr.md). Use `fetchStreamSnapshot` to capture and drain an open query.

Bounds take effect after a new emission. Until then, an oversized seed remains. Each publication uses a new array and leaves earlier histories unchanged. The arrays are not frozen at runtime. Treat cache values as immutable. A bound limits element count. It does not limit retained object size or bytes.

By default, each consumed value contributes to cache writes. Native structural sharing does not suppress those writes or guarantee a renderer's update count. For complete current-state emissions, choose a live query. For recent events, choose bounded history. The latest delta alone cannot reconstruct state. Set the publication rate or sampling on the producer or an application-owned Stream transformation.

## Recover an application-owned stream

Use `recoverStream({ connect, cursor, retryDelay, ...hooks })` around a native Effect Stream when delivery has a nonnegative safe-integer cursor. It starts from `initialCursor ?? 0` and discards events at or below the last accepted cursor. Use a positive first event cursor when the initial value is zero. Each consumption owns independent cursor state. Keep attempt-specific resume values inside `connect`; keep generated query input stable.

`retryDelay(cause, attempt)` receives the complete attempt Cause after local cleanup and a one-based count across the consumption; return undefined to preserve the terminal Cause. Backoff is cancellable. Pair `isReplayExpired` with `onReplayExpired` to refresh authoritative data and return its replay cursor before reconnecting. `onGap` runs before accepting a jump. `onState` reports local connection and delivery states. These hooks do not acknowledge remote persistence or cleanup. Authentication, replay storage, sequence epochs, and shared owner coordination remain application decisions.

Native cancellation can settle before old iterator finalization. Refetch can start the next stream during that cleanup. Coordinate exclusive resources in the application; keep clients and runtimes alive until their finalizers finish.

## Trace stream consumption and cleanup

When `Stream.unwrap` begins consumption, acquire an `Effect.makeSpanScoped` span. Provide it as `Tracer.ParentSpan` for nested pull work. Update the captured span directly from emission instrumentation and `Stream.ensuring`. The span then stays open through asynchronous local cleanup. Supply telemetry services through the ready client or its runner. Keep the runtime alive through iterator cleanup.

A span or retry around the runner's iterable-creation Effect ends before consumption. It does not cover stream emissions or finalization.

For a complete example with an HTTP SSE client, Otlp layer, and drained snapshot, use [the stream lifetime tracing recipe](https://ueberbrot.github.io/effect-api-query/guides/trace-streams/). To preserve decoded header wrappers, use the client's response transformation before response-mode wrapping. Applications own span attributes and disclosure policy.

Sources: [builders](https://ueberbrot.github.io/effect-api-query/reference/generated-builders/), [stream history](https://ueberbrot.github.io/effect-api-query/guides/choose-stream-history/).
