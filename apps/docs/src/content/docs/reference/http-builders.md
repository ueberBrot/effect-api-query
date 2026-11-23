---
title: HTTP Builders
description: HTTP query, metadata, mutation, pagination, and decoded stream option contracts.
---

Use `key()` on each retained branch and endpoint for prefix filters. See the [HTTP factory](/effect-api-query/reference/http-factory/) for supported endpoint and request shapes.

Key builders return immutable keys tagged with cache data and error types. Option builders return fresh native options.

| Builder | View |
| --- | --- |
| `queryKey(options?)`, `queryOptions(options?)` | Decoded query data. |
| `metadataKey(options?)`, `metadataOptions(options?)` | Decoded data, status, and raw headers. |
| `infiniteKey(options?)`, `infiniteOptions(options)` | Native `InfiniteData` for paginated responses. |
| `mutationKey()`, `mutationOptions(options?)` | Mutation options whose variables are supplied at execution. |
| `streamedKey({ input, ...policy })`, `streamedOptions(options)` | Accumulated SSE or NDJSON emissions with retention and publication policy. |
| `liveKey(options?)`, `liveOptions(options?)` | Latest SSE or NDJSON emission. |

For input-bearing keys, pass `{ input }` with any view settings in the same object. Inputless keys omit `input`. Use `skipToken` only with option builders.

Input-bearing keys take a complete request. Inputless stream keys take their policy as the first argument. Buffered multipart endpoints support mutation builders and direct execution. SSE and NDJSON endpoints only build accumulated and live queries.

## Query options

See [queries](/effect-api-query/guides/queries/) for a read example.

Pass ordinary options to native query, Suspense, or prefetch hooks, or to QueryClient. `select` changes the consumer's data, while the key retains the full cached type. Callbacks infer result, error, and input types. The type of `initialData` determines the native hook overload.

The builder supplies the key and function and removes `input`. Set hashing through QueryClient defaults and keep it stable. Per-call hash overrides and conflicting stream identities throw `EffectHttpApiQueryConfigError` with code `UnsupportedQueryHash`.

Pass a complete request or `input: skipToken`. Skipping preserves other options, returns the exact sentinel as `queryFn`, and uses the operation prefix. It encodes and sends no request. Native skipped hook data can be undefined even when initial data exists.

Use a complete input before calling `refetch`. If input exists and you only want manual execution, set `enabled: false`. Inputless builders, key builders, mutations, and Suspense and prefetch-only hooks reject `skipToken`.

## Mutation options

`mutationOptions(options?)` supplies `mutationKey` and `mutationFn`. Pass the decoded request as variables when the mutation runs. Variables stay out of the key. Callbacks infer result, request, and error types. A successful mutation can return `undefined`.

Mutations have no query abort signal. Use callbacks to invalidate, seed, or update reads. See [mutations](/effect-api-query/guides/mutations/).

## Run a buffered endpoint directly

Use `call({ input, signal })` for a promise or `effect({ input })` for the client Effect. Omit `input` for requests without input. Queryable endpoints also accept their own prepared input. For buffered multipart endpoints, supply the request with its `FormData` payload.

Both methods use decoded-only response mode and preserve successful `undefined`. `call` uses the leaf's runtime, including tracking added by `QueryOwner.trackUtils`. A failed Exit rejects with `EffectHttpApiQueryError` and operation `"call"`. With `effect`, you provide any required services and run the Effect.

## Buffered metadata

Buffered query endpoints support `metadataKey({ input: request })` and `metadataOptions({ input, ...options })`. Omit the request for inputless endpoints. The client runs in decoded-and-response mode. The cache holds this envelope.

```ts
type Metadata<DecodedSuccess> = {
  readonly data: QueryData<DecodedSuccess>;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
};
```

The adapter freezes the envelope and its copied header record. It keeps the decoded `data` reference, including any `WithHeaders` wrapper. Only a whole `undefined` becomes `null`. Raw headers retain their values without Effect inspection redaction. Select public headers before persistence or hydration.

Global and prefix sharing policies apply to fetched metadata. A policy passed to `metadataOptions` overrides them. If sharing returns a mutable envelope or header record, the adapter copies and freezes it without replacing its decoded data. Initial data, hydrated values, manual writes, and decoded data retain their ownership.

Selection and manual writes use the sharing policy set on `metadataOptions`, or standard deep sharing. Global and prefix policies apply only to fetched metadata.

A fresh-cache hit in `queryClient.query(newOptions)` keeps the installed options. An observer or a fetch must install a changed sharing policy before it applies to manual writes.

Metadata keys use a `metadata` segment and the ordinary request identity. Endpoint prefixes match every view. Native selection, initial data, skipping, hashing, and cancellation apply. A failed metadata query preserves the error and service contract of its client mode. Metadata is a buffered query view, separate from mutations, infinite lists, multipart, and streams.

The cache stores decoded data and copied metadata. Use the [ETag example](/effect-api-query/guides/http-metadata/#update-with-an-etag) for a conditional write.

## Accumulated stream options

Pass native options, decoded input if required, and these stream controls.

| Option | Contract |
| --- | --- |
| `maxChunks` | Required positive safe integer that limits retained events, or `"unbounded"`. A configured leaf can inherit this choice. |
| `refetchMode` | `reset` (default), `append`, or `replace`. |
| `publicationBatchSize` | Positive safe integer for ordered publication batches. Defaults to 1. |
| `publicationMaxWaitMs` | Integer from 1 through 2,147,483,647. Flushes a partial batch from its first buffered event. Omitted means no deadline. |
| `sseOptions.maxEventSize` (SSE only) | Positive safe integer that limits pending parser text. Defaults to 10 × 1024 × 1024 JavaScript string code units. |

The query caches a readonly array in emission order. It preserves `undefined` elements and decoded header wrappers. An empty stream can succeed. Acquisition and consumption failures produce `EffectHttpApiQueryError` with operation `streamed`. Its Cause retains HTTP, Schema, and ready-client failures. SSE can also report declared failures, `Sse.Retry`, and `Sse.SseError`. NDJSON framing and decoding follow the client's error channel.

The runner supplies stream services and receives the query abort signal. Cancellation closes the iterator and follows native cache reversion.

The first event publishes immediately. Later events publish by batch. Completion or failure flushes pending values, except that `replace` publishes only on success. Cancellation discards pending values. Set a deadline if a quiet stream must publish a partial batch. Invalid size or deadline throws `RangeError` before execution, even for skipped input. The builder strips the controls from native options.

Pass the same decoder and history settings to `streamedKey({ input, ...policy })` or `streamedKey(policy)` if inputless. Set `maxChunks` explicitly or inherit it through `configureUtils`. Omitted batch size and size one share a key. Nondefault sizes and explicit deadlines have distinct keys. Endpoint prefixes match all policies. Resume headers declared on the endpoint affect request identity. Decoder controls belong to view policy.

Set NDJSON's `maxElementBytes` on `HttpApiSchema.StreamNdjson`. Effect frames and decodes the stream, including any declared header wrapper. Only SSE takes `sseOptions`. Streaming endpoints have no metadata view.

See [accumulate values](/effect-api-query/guides/streaming/#accumulate-values) and [batch publication](/effect-api-query/guides/choose-stream-history/#batch-accumulated-publications) for examples.

## Live stream options

Pass native options and decoded input if required to `liveOptions`. Use the options' `queryKey` or pass the same policy to `liveKey`. SSE adds `sseOptions` to the policy. Either transport can use [`coalesceMs`](/effect-api-query/guides/choose-stream-history/#coalesce-complete-live-snapshots). The tagged key describes the latest data and execution error union, including `EffectHttpApiQueryEmptyStreamError`. Selection, initial data, and skipped input retain native inference.

The first value makes the query successful. Later publications replace the cached value. Completion keeps the last value. Only a whole `undefined` becomes `null`. Decoded header wrappers retain their body and headers.

If the stream ends before its first value, the error includes endpoint metadata. Use retention, refetch mode, and publication batches only for accumulated history.

Both views share the underlying error, service, and cleanup contract. SSE validates decoder options even when skipped. The endpoint prefix matches all stream keys. See [keep the latest value](/effect-api-query/guides/streaming/#keep-the-latest-value).

## Pagination

Supply `initialPageParam` and `getNextPageParam`. If the endpoint takes input, use `input(pageParam)` to build each decoded request or use `input: skipToken` to pause. Omit `input` for inputless endpoints.

The first mapped request forms the infinite key. Use `infiniteKey({ input: request })` or `infiniteKey()` if inputless. The `infinite` segment separates it from ordinary queries. Keys from `infiniteOptions` retain the inferred page parameter.

Use the same filters in the first request and each later page. Rebuild options if filters change. The mapper must be deterministic because key creation and page execution both call it.

QueryClient stores `InfiniteData`. Use `select` to change the returned shape while keeping pages in the cache. Each page follows ordinary HTTP rules for normalization, errors, and cancellation. See [pagination](/effect-api-query/guides/pagination/).

## Cache identity and failures

HTTP roots include `keyPrefix`, `http`, and the HttpApi identifier. Keys then add the endpoint path, operation, and canonical request if present. Use `utils.key()` to target the HTTP tree. Use the original prefix if you intend to target RPC and HTTP together.

The library synchronously encodes each declared request part and retains its label. A payload sent as URL parameters still uses `payload` in the key. Preparation uses the endpoint Schemas without building a request or body.

Encoded object members with value `undefined` are omitted. Encoded `null` stays `null`. Arrays stay ordered and reject holes or `undefined` entries. Header names become lowercase. Equal duplicates merge and conflicting duplicates fail.

Other key values must be strict JSON. Preparation checks finite numbers, plain objects, and cycles. It copies arrays, sorts object properties, and freezes the result.

Use a custom encoder for multiple effective query payload Schemas, including those with the same content type. Factory validation checks alternatives even if TypeScript cannot distinguish them. For binary input, return a JSON-safe projection. See [HTTP custom encoders](/effect-api-query/guides/custom-key-encoders/#http-requests).

`EffectHttpApiQueryKeyError` identifies the API, group, endpoint, and method. Its code identifies the failure.

| Code | Trigger |
| --- | --- |
| `RequestEncodingFailed` | A default request-schema encoder fails. |
| `KeyEncoderFailed` | A custom encoder throws. |
| `InvalidKeyValue` | Encoded identity violates canonical JSON or has conflicting header names. |

Key errors throw before the client runs. Mutations encode input within the ready client's Effect. Custom encoder output must be strict JSON. It skips the default HTTP omission and header rules.

Multipart mutation keys identify the operation without its variables or files. Use `mutationKey()` for that key. After a write, use the affected reads' keys to invalidate their entries.

`EffectHttpApiQueryError` wraps a failed execution Exit with the complete Cause. The wrapper includes API, group, endpoint, method, and operation. The Cause can still contain requests, responses, or Schema values. Use `isEffectHttpApiQueryError` to narrow it and check the [other error classes](/effect-api-query/reference/errors/) for configuration or key failures.
