---
title: RPC Builders
description: Branch and RPC leaf methods for keys, queries, mutations, and streams.
---

Every branch and leaf exposes `key()`. It returns the branch or leaf's immutable cache-key prefix.

Unary RPC leaves also expose these builders:

| Builder | Result |
| --- | --- |
| `queryKey(input?)` | Payload-specific, data-tagged query key. Payload-bearing RPCs require constructor input. |
| `queryOptions(options?)` | Fresh Query Core options with generated `queryFn` and `queryKey`. |
| `infiniteKey(input?)` | Data-tagged infinite-query key derived from the initial page's payload. |
| `infiniteOptions(options)` | Fresh infinite-query options that map each `pageParam` to an RPC payload. |
| `mutationKey()` | Immutable operation key shared by mutations of this RPC. |
| `mutationOptions(options?)` | Fresh mutation options with generated `mutationFn` and `mutationKey`. Pass variables when the mutation runs. |

An RPC is payloadless if it omits `payload` or declares `Schema.Void`. Declarations using `Schema.Unknown`, `Schema.Any`, or unions containing `Schema.Void` remain payload-bearing. Their key builders accept constructor input. Their query builders require an `input` field, and infinite queries require a mapper from page parameters to input. Mutation variables retain the declaration's input type. Custom encoders retain its normalized payload type.

Payloadless query builders take no input. Payload-bearing builders require an `input` field. The `input: skipToken` form disables a query and retains its other TanStack options. See [Queries](/effect-api-query/guides/queries/) and [Conditional Queries](/effect-api-query/guides/conditional-queries/) for usage.

RPC payload Schemas with opaque encoding middleware require a custom key encoder, even when the middleware is synchronous and service-free. TypeScript cannot always detect opaque middleware. Factory construction also validates this requirement at runtime. See [Custom Key Encoders](/effect-api-query/guides/custom-key-encoders/).

Builders remove `input` from the returned options. Accumulated-stream builders also remove `refetchMode`, `maxChunks`, and `publicationBatchSize`. Skipped options retain the exact sentinel and operation-level key.

`queryOptions`, `streamedOptions`, and `liveOptions` accept conditional `input` unions of payload constructor input and `skipToken`. Concrete inputs retain callable query functions and payload-specific keys. Conditional inputs retain the possible sentinel and both key shapes. An input typed `unknown` or `any` can contain the sentinel, so it returns conditional options.

Only payload-bearing query options accept `skipToken`. Key and mutation builders reject it. Suspense and prefetch-only hooks cannot use skipped options.

QueryClient global or prefix defaults configure custom hashing. Builders reject per-call `queryKeyHashFn` and `queryHash` with `EffectRpcQueryConfigError` code `UnsupportedQueryHash`. Hash defaults must remain stable while entries are cached. If changed hashing conflicts with a matching cached entry, stream execution also rejects with that code.

## Request-local RPC options

All option builders accept `rpcOptions`. The package forwards these options to the ready RPC client on each execution. It removes them from the returned Query Core options, including skipped queries.

| Builders | Request options |
| --- | --- |
| `queryOptions`, `infiniteOptions`, `mutationOptions` | `UnaryRpcOptions`: `headers` and `context` |
| `streamedOptions`, `liveOptions` | `StreamingRpcOptions`: `headers`, `context`, and `streamBufferSize` |

`headers` accepts Effect's `Headers.Input`. The `context` field accepts `Context.Context<never>`. `streamBufferSize` is a number that configures the Effect client's stream buffer. It is independent of `maxChunks`, which limits the accumulated query cache.

Each builder result fixes its request options. Infinite pages, retries, refetches, and repeated mutations reuse those options. Callbacks based on variables or page parameters are unsupported. If `rpcOptions` is omitted, the ready client's defaults remain in effect.

Unary operations need their result, so `discard` is unavailable. The package adapts streams itself, so `asQueue` is unavailable. Request options do not affect generated keys. If a header changes the identity of returned data, separate cache entries require that identity in the RPC payload or an application-owned key prefix.

See [Client Lifecycle](/effect-api-query/concepts/client-lifecycle/) for application-wide configuration.

## Build an infinite query

The input mapper converts each page parameter to the unary RPC payload. The initial mapped payload also determines the semantic cache key. [Pagination](/effect-api-query/guides/pagination/) shows how to build a paginated query.

Payloadless RPCs omit `input`. A payload-bearing infinite query is disabled when its `input` field is `skipToken`. The mapper and sentinel can also share one conditional input.

Concrete mappers retain callable query functions and payload-specific keys. The exact sentinel retains the operation key. Conditional inputs preserve both key shapes and the query-function union. Mapper results must be payload constructor input.

When supplied, a defined `initialData` value or factory remains required in the generated options. This preserves `useInfiniteQuery`'s defined-data inference for payload-bearing and payloadless RPCs, including conditional and skipped inputs. A factory that can return `undefined` keeps hook data possibly undefined.

The builder owns `queryFn` and `queryKey` and forwards applicable Query Core options. QueryClient defaults own hashing. Each page uses the same Effect runner and cancellation signal as an ordinary query.

## Stream values

Streaming RPC leaves expose these builders:

| Builder | Result |
| --- | --- |
| `streamedKey(input, policy?)` | Data-tagged key for accumulated data and its retention, refetch, and publication policy. |
| `streamedOptions(options?)` | Fresh Query Core options that append each emitted value to an array. |
| `liveKey(input?)` | Data-tagged key for the latest value. |
| `liveOptions(options?)` | Fresh Query Core options that replace the cached value after each emission. |

See [Streaming](/effect-api-query/guides/streaming/) for usage.

Both option builders publish the query as successful after its first value. They keep `fetchStatus: 'fetching'` until the stream ends. An empty accumulated stream succeeds. A new unseeded view resolves to `[]`. An empty live stream fails with `EffectRpcQueryEmptyStreamError`.

Live queries convert emitted `undefined` to `null`. Explicit `null` stays `null`. Their keys, selectors, and initial-data options describe the normalized value. Accumulated arrays preserve `undefined` elements.

For an inputless RPC, the key builder takes the form `streamedKey(policy?)`. Omitted policy means unlimited history, reset refetches, and publication after each event. Exact reads, seeding, cancellation, and refetches require the same policy in the key and options builders.

Accumulated streams accept these values for TanStack's `refetchMode` option:

- `reset` clears cached values and returns the query to pending before refetching. This is the default.
- `append` adds the new stream's values to the cached sequence.
- `replace` retains the old sequence until the new stream ends, then replaces it atomically.

A positive safe integer for `maxChunks` limits retention to the newest emitted elements in order.

After each publication, the accumulated array contains at most `maxChunks` elements. On refetch:

- `reset` starts an empty accumulation, even when `initialData` was supplied.
- `append` trims the combined cached and new history.
- `replace` builds a bounded replacement and publishes it when the stream completes.

Initial fetches and append refetches trim existing data on a publication. An empty append refetch preserves existing data. Empty reset and replace refetches finish with an empty array.

`publicationBatchSize` is a positive safe integer and defaults to one. The first event publishes immediately. Later events publish in ordered batches of that size. Completion or failure flushes a partial batch. A `replace` refetch still publishes only after successful completion. Cancellation discards unpublished events and follows native cache reversion. Batching sets no timer, so a partial batch can remain unpublished indefinitely while the stream stays open. See [Batch Accumulated Publications](/effect-api-query/guides/choose-stream-history/#batch-accumulated-publications).

The bound discards older history and limits the number of elements. It does not limit byte size. Without a bound, accumulation remains unbounded. The `liveOptions` builder retains only the latest value.

`maxChunks`, `refetchMode`, and nondefault `publicationBatchSize` contribute to concrete accumulated-stream identity. Omitted values mean unlimited retention, `reset`, and a batch size of one. Explicit `undefined`, explicit `reset`, and explicit one produce the corresponding default identity. Different policies have separate histories, including concurrent views of the same RPC payload. Root, branch, RPC, and streamed-operation prefixes still match every policy.

Builders remove all three fields before they return options, including skipped options. Invalid bounds throw `EffectRpcQueryConfigError` with code `InvalidMaxChunks`. Invalid modes use `InvalidRefetchMode`. Invalid publication batch sizes throw `RangeError`. These checks run synchronously, even when `input` is `skipToken`.

Exact accumulated-stream keys come from the builders with the view's policy. Their concrete suffix is opaque. Applications that persist data choose their own schema and key-version busters. See [Switch Cache Owners](/effect-api-query/guides/switch-cache-owners/#restore-a-directory-snapshot).

Live queries always replace the cached value and expose no `refetchMode`, `maxChunks`, or `publicationBatchSize`. When a query is cancelled or superseded, its iterator closes and its Effect resources are interrupted. Unmounting the last observer cancels active work. Other observers keep a shared query active.
