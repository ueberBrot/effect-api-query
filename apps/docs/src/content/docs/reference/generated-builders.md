---
title: RPC Builders
description: Branch and RPC leaf methods for keys, queries, mutations, and streams.
---

Use `key()` on a branch or leaf to match all query keys under it. It returns a frozen prefix.

Unary RPCs provide these builders.

| Builder | Result |
| --- | --- |
| `queryKey(input?)` | Payload-specific, data-tagged query key. Payload-bearing RPCs require constructor input. |
| `queryOptions(options?)` | Fresh Query Core options with generated `queryFn` and `queryKey`. |
| `infiniteKey(input?)` | Data-tagged infinite-query key derived from the initial page's payload. |
| `infiniteOptions(options)` | Fresh infinite-query options that map each `pageParam` to an RPC payload. |
| `mutationKey()` | Immutable operation key shared by mutations of this RPC. |
| `mutationOptions(options?)` | Fresh mutation options with generated `mutationFn` and `mutationKey`. Pass variables when the mutation runs. |

An RPC takes no payload if it omits `payload` or uses `Schema.Void`. `Schema.Unknown`, `Schema.Any`, and unions containing `Schema.Void` still take payloads. Use constructor input for keys, query options, mutation variables, and infinite page mappers. Custom encoders get the normalized payload.

Set `input: skipToken` to keep the other Query options and pause an RPC with input. Omit input for a payloadless RPC. See [conditional queries](/effect-api-query/guides/conditional-queries/).

Use a [custom key encoder](/effect-api-query/guides/custom-key-encoders/) for opaque encoding middleware, even if it runs synchronously without services. The factory also checks this at runtime.

Builders remove `input` and adapter-specific controls before returning native options. Skipped options keep the exact sentinel as `queryFn` and use the operation prefix.

Concrete input gives `queryOptions`, `streamedOptions`, and `liveOptions` a callable query function and a payload-specific key. Conditional input preserves both key and function shapes. Input typed `unknown` or `any` also yields conditional options because it can contain `skipToken`.

Use `skipToken` on query option builders that take input. Key builders, mutations, Suspense hooks, and prefetch-only hooks reject it.

Set hashing through QueryClient defaults and keep it stable while entries exist. Per-call `queryKeyHashFn` and `queryHash` throw `EffectRpcQueryConfigError` with code `UnsupportedQueryHash`. Stream execution also uses this code if a hashing change conflicts with an existing key.

## Request-local RPC options

All option builders accept `rpcOptions`. They pass it to the ready client at execution and omit it from the returned Query options.

| Builders | Request options |
| --- | --- |
| `queryOptions`, `infiniteOptions`, `mutationOptions` | `UnaryRpcOptions`: `headers` and `context` |
| `streamedOptions`, `liveOptions` | `StreamingRpcOptions`: `headers`, `context`, and `streamBufferSize` |

`headers` accepts Effect's `Headers.Input`. `context` accepts `Context.Context<never>`. Use `streamBufferSize` for the client's stream buffer and `maxChunks` for retained cache history.

One options object fixes request options for pages, retries, refetches, and repeated mutations. Use a new builder call to change them. When you omit `rpcOptions`, the client uses its defaults.

Unary operations need results and streams use the client's stream form. Leave out `discard` and `asQueue`. If a header changes the result, include a safe identity in the payload or key prefix. Request options stay out of generated keys.

See [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for application-wide configuration.

## Build an infinite query

Map each page parameter to the unary RPC payload. The first mapped payload determines the key. See [pagination](/effect-api-query/guides/pagination/) for an example.

Omit `input` for an inputless RPC. Otherwise pass a page mapper, `skipToken`, or a conditional choice between them.

A mapper gives a callable query function and payload-specific key. The sentinel uses the operation prefix. Conditional options retain both shapes. Each mapper result must be valid constructor input.

A defined `initialData` value or factory keeps data defined in `useInfiniteQuery`, including conditional and skipped cases. A factory that can return `undefined` gives optional data.

The builder supplies the key and function and forwards Query options. Each page uses the ordinary Effect runner and abort signal.

## Stream values

Streaming RPCs provide these builders.

| Builder | Result |
| --- | --- |
| `streamedKey(options)` | Data-tagged key for history and its retention, refetch, and publication policy. |
| `streamedOptions(options)` | Query options that accumulate emitted values according to the history policy. |
| `liveKey(options?)` | Data-tagged key for the latest value and any coalescing policy. |
| `liveOptions(options?)` | Query options that store the latest published value. |

See [streaming](/effect-api-query/guides/streaming/) for examples.

The first value makes the query successful while `fetchStatus` stays `fetching`. A new unseeded accumulated query can finish with `[]`. An empty live query fails with `EffectRpcQueryEmptyStreamError`.

Live queries convert `undefined` to `null`. Their keys, selectors, and initial data use that type. Accumulated arrays preserve `undefined`.

For an inputless RPC, call `streamedKey(policy)`. Use the same policy for exact keys and options.

Choose a `refetchMode` for accumulated history.

- `reset` clears the cache and sets the query to pending before refetch. This is the default.
- `append` adds incoming values to the cached sequence.
- `replace` keeps cached values until the next stream completes successfully.

Set `maxChunks` to a positive safe integer or `"unbounded"`. You can set it through [`streamed`](/effect-api-query/guides/query-defaults/) for a tree, branch, or leaf.

A finite bound keeps the newest values in order after publication. It counts elements. Refetch applies the bound as follows.

- `reset` starts empty even with `initialData`.
- `append` trims combined history on publication.
- `replace` builds bounded history and publishes it on completion.

An empty append keeps its cached data. Empty reset and replace finish with an empty array.

`publicationBatchSize` is a positive safe integer and defaults to one. The first event publishes immediately. Later events publish in order by batch. Completion or failure flushes a partial batch, except that `replace` publishes only on success. Cancellation drops pending values and uses native cache reversion. See [batch publication](/effect-api-query/guides/choose-stream-history/#batch-accumulated-publications).

Set `publicationMaxWaitMs` to an integer from 1 to 2,147,483,647 to flush a partial batch from its oldest pending event. Omit it for count-only batching, which can leave a partial batch pending while the stream stays open. Cancellation clears the timer. Scheduling and finalizers can delay completion.

Accumulated keys include retention and refetch settings, nondefault batch sizes, and explicit deadlines. Omitted refetch mode and batch size share the keys for `reset` and one. `"unbounded"` keeps the original unlimited-history representation. Prefixes still match across all policies.

Builders strip these four controls from native options. Invalid retention or mode throws `EffectRpcQueryConfigError` with `InvalidMaxChunks` or `InvalidRefetchMode`. Invalid batch size or deadline throws `RangeError`. The same checks run for skipped input.

Let the builder produce the exact suffix. If you persist data, use [schema and key versions](/effect-api-query/guides/switch-cache-owners/#restore-a-directory-snapshot).

A live query publishes the latest value. For complete snapshots, use [`coalesceMs`](/effect-api-query/guides/choose-stream-history/#coalesce-complete-live-snapshots) to combine updates. The policy also affects the exact key. Live builders exclude accumulated controls. Cancelling or replacing a query closes its iterator and interrupts local resources. A stream can keep running while another ordinary observer uses it.
