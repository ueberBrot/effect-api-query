# Conditional reads, pages, and streams

## Reuse inferred operation types

Import the inference helpers from `@ueberbrot/effect-api-query` and apply them to a leaf.

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

`'infinite'` gives `InfiniteData` with unknown page parameters. Use the options' tagged key to retain the parameter inferred from a mapper. Query and live views convert `undefined` to `null`. Accumulated elements and mutation data keep it.

Choose a supported view for `InferQueryData` or `InferQueryError`. Streams need explicit `'live'` or `'streamed'`. A branch or unsupported default view gives `never`. Runtime runner rejections can pass through outside the declared error union.

See [type inference](https://ueberbrot.github.io/effect-api-query/reference/type-inference/) for the view and input types.

## Conditional reads with React Query

If required input is missing, use `input: skipToken`. If input is valid and the query should run only on manual refetch, use `enabled: false`.

Call this factory with the app's ready RPC client, then use the returned hook under its `QueryClientProvider`.

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
  client: RpcClient.RpcClient<RpcGroup.Rpcs<typeof users>>
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

HTTP uses the same pattern with decoded input. Query, metadata, streamed, and live builders retain native options when skipped. Keep the sentinel out of key builders, mutations, and inputless operations. Supply real input before manual refetch. Use ordinary hooks because Suspense and prefetch-only hooks reject skipped options.

## Infinite queries

Map each page parameter to a complete input. The first mapped request sets the key. Include the same filters on each page. Key creation and execution both call the mapper, so keep it deterministic.

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
  client: RpcClient.RpcClient<RpcGroup.Rpcs<typeof catalog>>,
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

Pass the options to `useInfiniteQuery`. For HTTP, return the decoded request, such as `{ query: { cursor, category: 'books' } }`. Use `infiniteKey` with the complete first input for exact cache access. To pause pagination, set `input: skipToken` on the options object.

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
  client: RpcClient.RpcClient<RpcGroup.Rpcs<typeof events>>
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
    historyKey: rpc.events.watch.streamedKey({ input, ...policy }),
    latest: rpc.events.watch.liveOptions({ input }),
  };
}
```

Use either set of options with an ordinary hook or observer. History and latest values have separate keys. Observing both starts two executions.

For accumulated history, set `maxChunks` to a positive safe integer or `"unbounded"`. Set it directly for each key and options builder, or configure `streamed`. Different retention bounds and refetch modes use distinct entries. Unbounded retention with reset keeps the original unlimited-history key.

Reuse the options' `queryKey` or call `streamedKey({ input, ...policy })`. For an inputless operation, use `streamedKey(policy)`. Include SSE decoder options for HTTP SSE. NDJSON uses its declaration's decoder limits.

Choose a refetch mode for accumulated history.

- `reset` clears data and sets the query to pending. This is the default.
- `append` adds the new values to the cached sequence.
- `replace` keeps the old history until the new stream finishes successfully.

Set `publicationBatchSize` to a positive safe integer. The first event publishes immediately. Later values publish in order by batch. Completion or failure flushes a partial batch, except that `replace` publishes only on success. Cancellation discards pending events. Set `publicationMaxWaitMs` from 1 to 2,147,483,647 to flush a quiet batch from its oldest pending event. Omit it for count-only batching. Explicit deadlines and sizes above one change the key.

Use `coalesceMs` only when each live emission is complete state. Use a whole number from 1 to 2,147,483,647 milliseconds. Each fetch publishes the first value immediately. The next value starts a fixed timer and subsequent values replace the pending snapshot. Completion or failure flushes it. Cancellation drops it and clears the timer. Scheduling can delay publication.

Pass matching policy to `liveKey({ input, coalesceMs })` or `liveKey({ coalesceMs })` if inputless. Set `live.coalesceMs` to share this across keys and options. Omit the local value to inherit it. Pass `coalesceMs: undefined` to clear it. Explicit deadlines change the key. Pass the same local `sseOptions` for keys and options.

An empty unseeded accumulated stream resolves to `[]`. An empty append keeps existing history. Empty reset and replace finish with `[]`. A live stream that completes before its first value raises the adapter's empty-stream error. Aborting before the first value follows native cancellation.

A live query converts each emitted `undefined` to `null`. Its keys, selectors, and initial data use the normalized type. Accumulated history keeps the original elements.

The adapter publishes through public Query Core cache operations. Native reads, writes, observers, and sharing policies address the same entry.

The first publication makes an initial fetch successful while fetching continues. Ordinary cancellation closes the iterator and interrupts Effect. Await local cleanup before disposal because native cancellation can settle first. See [frameworks and hosts](frameworks-and-hosts.md) for Suspense limits.

Imperative queries wait for stream completion. Hooks and observers see intermediate values. For server rendering, use [stream capture](hydration-and-ssr.md#capture-an-open-stream) to get a finite result and wait for cleanup.

The history bound counts elements after publication. An oversized seed can remain until new data publishes. Each publication uses a new array. Keep the values unchanged. Set byte and transport limits separately.

Structural sharing can reuse references while writes still notify the cache. For complete state, use a live query. For ordered changes, use history. To change the producer's rate or sample events, transform the application stream.

## Recover an application-owned stream

Wrap a decoded Effect Stream with `recoverStream({ connect, cursor, retryDelay, ...hooks })`. The default accepts increasing nonnegative safe integers above `initialCursor ?? 0`. Each consumption has its own cursor. Keep resume state in `connect` so generated query input stays stable.

For opaque or structured cursors, supply `initialCursor` and `cursorPolicy: { accept(previous, next), isGap? }`. Define order and duplicate rules in `accept`. `isGap` runs for accepted events before advancement. Equality alone suppresses only the latest repeat. Decode and keep cursor objects unchanged. `StreamConnectionState<E, C>` carries the type. Hooks keep their inferred Effect requirements. See [reconnect streams](https://ueberbrot.github.io/effect-api-query/guides/reconnect-streams/).

`retryDelay(cause, attempt)` receives the full Cause after cleanup and a one-based retry count. Return `undefined` to stop with that Cause. Pair `isReplayExpired` with `onReplayExpired` to refresh state and return a matching cursor. `onGap` runs before accepting a jump. `onState` reports local state. Keep authentication, replay storage, and acknowledgements in the app.

A refetch can start while the previous stream cleans up. Coordinate exclusive resources in the app and keep the client and runtime alive until finalizers finish.

## Trace stream consumption and cleanup

In `Stream.unwrap`, acquire an `Effect.makeSpanScoped` span. Provide it as `Tracer.ParentSpan` for pulls. Record events and finalization on the captured span. Keep telemetry services alive through local cleanup.

A span or retry around iterable creation covers setup only. Attach consumption policy to the stream.

Use the [stream tracing example](https://ueberbrot.github.io/effect-api-query/guides/trace-streams/) for HTTP SSE, OTLP, and snapshot cleanup. If the endpoint has decoded header wrappers, preserve them when transforming the response.

See [RPC builders](https://ueberbrot.github.io/effect-api-query/reference/generated-builders/) for options and [stream history](https://ueberbrot.github.io/effect-api-query/guides/choose-stream-history/) for retention and publication.

## Prepare a reused input

For a reused input, call `prepareInput(leaf, input)`. Pass the handle to the same leaf's query keys or ordinary, metadata, live, and streamed options. For HTTP, supply decoded request parts. Keep retained inputs unchanged. Build a fresh handle if request values change.

Configured copies of a leaf share its handle owner. Other leaves and factory instances reject the handle. Use raw inputs for mutations and infinite page mappers. `InferInput` also describes raw input. Use hydration codecs to transfer data.

## Consume events without cache history

Run `consumeEvents(source, { onEvent, onStart?, onExit? })` inside the app's Scope for notifications or invalidation without cache history. It awaits each event handler and stops on its failure. `onStart` signals local startup. `onExit` receives the Exit after cleanup and runs before settlement. Interrupt and await the Effect before disposing of the runtime. Add `recoverStream` upstream if replay is needed.
