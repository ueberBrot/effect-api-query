---
title: HTTP Builders
description: HTTP query, metadata, mutation, pagination, and SSE option contracts.
---

Every retained branch and endpoint provides `key()` for prefix filters. The [HTTP Factory](/effect-api-query/reference/http-factory/) defines construction, supported endpoint shapes, and the decoded request contract.

Query key builders return immutable, data-tagged keys. Option builders return fresh native Query Core options for each view.

| Builder | View |
| --- | --- |
| `queryKey(input?)`, `queryOptions(options?)` | Decoded query data. |
| `metadataKey(input?)`, `metadataOptions(options?)` | Decoded data, status, and raw headers. |
| `infiniteKey(input?)`, `infiniteOptions(options)` | Native `InfiniteData` for paginated responses. |
| `mutationKey()`, `mutationOptions(options?)` | Mutation options whose variables are supplied at execution. |
| `streamedKey(input, policy)`, `streamedOptions(options)` | Accumulated SSE emissions with retention and decoder policy. |
| `liveKey(input?, policy?)`, `liveOptions(options?)` | Latest SSE emission with decoder policy. |

Input-bearing key builders require the complete request. Inputless streamed and live key builders take their policy as the first argument. Buffered multipart endpoints expose only mutation builders. SSE endpoints expose only accumulated and live builders.

## Query options

[Queries](/effect-api-query/guides/queries/) shows how to use query options.

Ordinary options work with native query, suspense, and prefetch hooks, as well as QueryClient operations. Callbacks retain the decoded result, complete failure union, and request types. The `select` option changes consumer data. Data-tagged keys retain the underlying cache data and error types. Defined or possibly undefined `initialData` preserves the corresponding TanStack hook overload.

Applicable TanStack options pass through. The package owns the key and function. It removes `input` before it returns options. QueryClient global and prefix defaults own hashing. Builders reject per-call `queryKeyHashFn` and `queryHash` with `EffectHttpApiQueryConfigError` code `UnsupportedQueryHash`. Hash defaults must remain stable while entries are cached. If changed hashing conflicts with a matching cached entry, stream execution also rejects with that code.

Input-bearing `queryOptions` accepts either a complete request in `input` or `queryOptions({ input: skipToken, ...options })`. The `skipToken` binding is exported from `effect-api-query` and TanStack. Skipping preserves caller options and returns the exact sentinel as `queryFn`, with the operation-level key and no request identity. It performs no request encoding or client call. Supplied initial data remains available, but native skipped hook data stays possibly undefined.

Inputless builders, key builders, and mutations reject `skipToken`. A skipped function cannot run through manual refetch. Manual execution requires valid input or `enabled: false` with a complete request. Native suspense and prefetch-only hooks reject skipped options.

## Mutation options

`mutationOptions(options?)` supplies `mutationKey` and `mutationFn`. A native mutation hook or observer receives the complete decoded request as variables at execution. Variables never enter the key. Callbacks retain result, request, and execution-error types. Successful `undefined` remains `undefined`.

Mutations have no query abort signal and no automatic relationship to cached reads. Native callbacks control invalidation, seeding, or optimistic updates. [Mutations](/effect-api-query/guides/mutations/) describes those choices.

## Buffered metadata

Query-enabled buffered endpoints also provide `metadataKey(request)` and `metadataOptions({ input, ...options })`. Inputless endpoints omit the request. The ready client runs in decoded-and-response mode. The cache contains this envelope:

```ts
type Metadata<DecodedSuccess> = {
  readonly data: QueryData<DecodedSuccess>;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
};
```

The adapter freezes the outer envelope and copied plain header record. The `data` field preserves the declared decoded value and its ownership, including decoded `WithHeaders` wrappers. Only top-level successful `undefined` becomes `null`. Raw headers retain their string values without Effect's inspection redaction. Applications decide which headers can be persisted or dehydrated.

Fetched snapshots remain frozen after structural sharing. Global and prefix sharing policies apply to fetched data. A policy passed to `metadataOptions` overrides those policies. If sharing selects mutable envelopes or header records, the adapter copies and freezes them while retaining the selected decoded data reference. The adapter does not freeze decoded data, caller-supplied `initialData`, hydrated values, or manual cache writes.

Selected observer results use the sharing policy explicitly passed to `metadataOptions`, or standard deep sharing if that policy is absent. After execution, manual cache writes use the same rule. Inherited global and prefix sharing policies apply only to fetched metadata snapshots.

A fresh-cache hit from imperative `queryClient.query(newOptions)` retains the Query's existing options. A changed sharing policy applies to later manual writes only after an observer or an actual fetch installs it.

Metadata keys use a `metadata` discriminator and the ordinary request identity. Endpoint prefixes match every view. Native `select`, `initialData`, skip-token inference, QueryClient hashing defaults, and cancellation apply to metadata options. Execution failures identify operation `metadata` and preserve that client mode's full error and service channels. Metadata adds no mutation or infinite builders. Multipart and streaming endpoints have no metadata view.

The cache retains the decoded value and metadata snapshot. It contains no response object or open body. See [Update with an ETag](/effect-api-query/guides/http-metadata/#update-with-an-etag) for conditional writes.

## Accumulated SSE options

`streamedOptions` accepts native query options, decoded `input` when declared, and these controls:

| Option | Contract |
| --- | --- |
| `maxChunks` | Required positive safe integer that limits retained events, or `"unbounded"`. A configured leaf can inherit this choice. |
| `refetchMode` | `reset` (default), `append`, or `replace`. |
| `publicationBatchSize` | Positive safe integer for ordered publication batches; defaults to one. |
| `publicationMaxWaitMs` | Integer from 1 through 2,147,483,647; flushes a partial batch from its first buffered event. Omitted means no deadline. |
| `sseOptions.maxEventSize` | Positive safe integer that limits pending parser text. The default is 10 MiB of JavaScript string code units. |

Decoded data is an ordered readonly array. Accumulated elements keep `undefined`. Decoded header wrappers surround each emitted body. Empty completion succeeds. Acquisition and consumption errors use `EffectHttpApiQueryError` with operation `streamed`. They preserve declared event failures, `Sse.Retry`, `Sse.SseError`, HTTP and Schema errors, and additional client channels.

The caller's runner supplies acquisition and consumption services and receives Query's abort signal. Cancellation closes the iterator and follows native Query cache reversion.

The first event publishes immediately. Later events publish in batches of `publicationBatchSize`. Completion or failure flushes a partial batch. A `replace` refetch still publishes only on successful completion. Cancellation discards unpublished events. Without `publicationMaxWaitMs`, partial batches can remain unpublished while a stream stays open. Invalid publication batch sizes or deadlines synchronously throw `RangeError`, including for skipped input. Builders remove publication controls from the returned Query options.

`streamedKey(input, policy)` accepts the same decoder, retention, refetch, and publication policy. Inputless endpoints use `streamedKey(policy)`. Supply `maxChunks` explicitly or inherit it through `configureUtils`. Equivalent policies have equal keys. Omitted or explicit batch size one has the same identity. Nondefault sizes and explicit deadlines have separate entries. Endpoint `key()` selects them all. Decoded request input and custom encoders exclude decoder controls. Declared resume headers remain part of request identity.

See [Accumulate Values](/effect-api-query/guides/streaming/#accumulate-values). See [Batch Accumulated Publications](/effect-api-query/guides/choose-stream-history/#batch-accumulated-publications) for count and deadline behavior.

## Live SSE options

`liveOptions` accepts native query options, declared decoded `input`, and `sseOptions`. The key builder is `liveKey(input, { sseOptions })`, or `liveKey({ sseOptions })` for inputless endpoints. It includes normalized decoder policy in the separate `live` identity. Live keys carry the latest decoded value and the execution error union, including `EffectHttpApiQueryEmptyStreamError`. Live builders preserve selection, initial-data, and skipped-input inference.

The first emission makes the query successful. Later emissions replace the cached value. Completion preserves the latest value. Only a top-level `undefined` becomes `null`. Declared header wrappers retain their decoded body and headers.

An empty live completion fails with declaration metadata. Live queries accept no `maxChunks`, accumulated `refetchMode`, `publicationBatchSize`, or `publicationMaxWaitMs`.

Live and accumulated SSE queries have the same acquisition and consumption errors and services, decoder limit validation, iterator cleanup, and caller-owned reconnection contract. Input-bearing builders validate decoder policy even when skipped. Endpoint prefixes match both representations and every concrete decoder policy. See [Keep the Latest Value](/effect-api-query/guides/streaming/#keep-the-latest-value).

## Pagination

`infiniteOptions` requires `initialPageParam` and `getNextPageParam`. For an input-bearing endpoint, `input(pageParam)` returns the complete decoded HTTP request for that page. Inputless endpoints omit `input`. Input-bearing endpoints can pause with `input: skipToken` in the options object. The direct sentinel form is unavailable.

The initial request determines cache identity. Infinite keys use an `infinite` discriminator to stay separate from ordinary queries for the same request. The `infiniteKey(request)` builder takes a complete initial request. The `infiniteKey()` form serves inputless endpoints. Keys returned by `infiniteOptions` also retain the inferred page-parameter type for cache reads.

Stable filters belong in both the initial request and every page. Changes to those filters require a changed initial request. The `getNextPageParam` callback advances cursors. The input mapper must be deterministic because the builder evaluates it for the initial key and execution evaluates it for every page.

QueryClient stores native `InfiniteData` and owns invalidation and refetching. Selections can transform consumer data without changing cached pages. Every page preserves the ordinary HTTP execution contract, including `undefined`-to-`null` normalization, wrapped errors, and cancellation. See [Pagination](/effect-api-query/guides/pagination/).

## Cache identity and failures

HTTP keys begin with `keyPrefix`, `http`, and the HttpApi identifier. The projected endpoint path and operation discriminator follow those root segments. Query keys append canonical request identity when the endpoint has input. The `utils.key()` prefix includes the generated root and matches every HTTP descendant. RPC utilities use a separate `rpc` discriminator. Cross-adapter invalidation uses the original caller prefix deliberately.

Default query preparation synchronously encodes the declared `params`, `query`, `payload`, and `headers` schemas. The key retains these labels, even when a bodyless method sends its payload as URL parameters. Preparation uses the endpoint's effective schemas without constructing an HTTP request or body. JSON, text, form-urlencoded requests, and requests without bodies follow the same rule.

Preparation omits encoded object members whose value is `undefined`. An encoded `null` stays `null`, including when Effect's JSON codec produces it from a decoded optional value. Arrays retain their order. Sparse arrays and encoded `undefined` items are rejected. Header field names become lowercase. Equal duplicates collapse, and conflicting duplicates fail.

Other values follow strict canonical JSON: finite numbers, plain objects, copied arrays, sorted object properties, cycle rejection, and deep freezing.

For endpoints with query support, multiple effective payload schemas require a custom encoder, including alternatives with the same content type. Types enforce this requirement when declarations retain distinct schemas. Runtime validation also covers alternatives that the declaration types no longer distinguish. Buffered binary input needs an explicit JSON-safe projection because default keys cannot contain `Uint8Array`. See [custom key encoders](/effect-api-query/guides/custom-key-encoders/#http-requests).

`EffectHttpApiQueryKeyError` identifies the API, group, endpoint, and method and distinguishes:

| Code | Trigger |
| --- | --- |
| `RequestEncodingFailed` | A default request-schema encoder fails. |
| `KeyEncoderFailed` | A custom encoder throws. |
| `InvalidKeyValue` | Encoded identity violates canonical JSON or has conflicting header names. |

These failures occur in `queryKey` or `queryOptions`, before the client runs. Mutation preparation does not encode a query key. Request encoding runs inside the ready client's Effect. Custom encoder output follows strict JSON. It bypasses the default HTTP rules that omit `undefined` members and normalize headers.

Multipart mutation keys contain no request variables or files. The `mutationKey()` builder identifies the operation, and `key()` retains the endpoint's normal invalidation prefix. Mutation callbacks can invalidate affected read endpoints. Multipart leaves have no query or infinite-query builders.

`EffectHttpApiQueryError` wraps a failed execution `Exit` and preserves its complete Cause. It identifies the API, group, endpoint, method, and operation. The package adds no concrete request values to that metadata. Upstream Causes can still contain requests, responses, or Schema issue values. The `isEffectHttpApiQueryError` guard narrows execution errors. Configuration failures use `EffectHttpApiQueryConfigError`. Key preparation failures use `EffectHttpApiQueryKeyError`.
