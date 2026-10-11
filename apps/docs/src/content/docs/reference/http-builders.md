---
title: HTTP Builders
description: HTTP query, metadata, mutation, pagination, and SSE option contracts.
---

Every retained branch and endpoint provides `key()` for prefix filtering. The
[HTTP Factory](/effect-api-query/reference/http-factory/) specifies construction, supported endpoint
shapes, and the decoded request contract.

Query key builders return immutable, data-tagged keys. Option builders return fresh native
Query Core options for the corresponding view.

| Builder                                                     | View                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `queryKey(input?)`, `queryOptions(options?)`                | Decoded query data.                                          |
| `metadataKey(input?)`, `metadataOptions(options?)`          | Decoded data, status, and raw headers.                       |
| `infiniteKey(input?)`, `infiniteOptions(options)`           | Native `InfiniteData` for paginated responses.               |
| `mutationKey()`, `mutationOptions(options?)`                | Mutation options whose variables are supplied at execution.  |
| `streamedKey(input?, policy?)`, `streamedOptions(options?)` | Accumulated SSE emissions with retention and decoder policy. |
| `liveKey(input?, policy?)`, `liveOptions(options?)`         | Latest SSE emission with decoder policy.                     |

Input-bearing key builders require the complete request. Inputless streamed and live key
builders take their policy as the first argument. Buffered multipart endpoints expose only
mutation builders; SSE endpoints expose only accumulated and live builders.

## Query options

See [Queries](/effect-api-query/guides/queries/) for usage.

Ordinary options work with native query, suspense, and prefetch hooks and QueryClient operations.
Callbacks retain the decoded result, complete failure union, and request types. `select` changes
consumer data; data-tagged keys retain the underlying cache data and error types. The type of
`initialData`, whether defined or possibly undefined, preserves the corresponding TanStack hook
overload.

Applicable TanStack options pass through. The package owns the key and function and removes
`input` before returning options. QueryClient global and prefix defaults own hashing. Builders
reject per-call `queryKeyHashFn` and `queryHash` with `EffectHttpApiQueryConfigError` code
`UnsupportedQueryHash`.
Keep hash defaults stable while entries remain cached. Stream execution also rejects with that
code when changed hashing conflicts with a matching cached entry.

Input-bearing `queryOptions` accepts a complete request in `input` or
`queryOptions({ input: skipToken, ...options })`. Import `skipToken` from `effect-api-query` or
TanStack. Skipping preserves caller options and returns the exact sentinel as `queryFn`, with the
operation-level key and no request identity. It performs no request encoding or client call.
Supplied initial data remains available, but native skipped hook data stays possibly undefined.

Inputless builders, key builders, and mutations reject `skipToken`. A skipped function cannot run
through manual refetch; supply valid input or use `enabled: false` with a complete request when
manual execution is required. Native suspense and prefetch-only hooks reject skipped options.

## Mutation options

`mutationOptions(options?)` supplies `mutationKey` and `mutationFn`. Pass the complete decoded
request as variables when a native mutation hook or observer executes it. Variables never enter
the key. Callbacks retain result, request, and execution-error types. Successful `undefined`
remains `undefined`.

Mutations have no query abort signal and no automatic relationship to cached reads. Choose
invalidation, seeding, or optimistic updates in native callbacks; see
[Mutations](/effect-api-query/guides/mutations/).

## Buffered metadata

Query-enabled buffered endpoints also provide `metadataKey(request)` and `metadataOptions({ input,
...options })`; inputless endpoints omit the request. The ready client runs in decoded-and-response
mode, and the cache contains:

```ts
type Metadata<DecodedSuccess> = {
  readonly data: QueryData<DecodedSuccess>
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
}
```

The outer envelope and copied plain header record are frozen. `data` preserves the declared decoded
value and its ownership, including decoded `WithHeaders` wrappers. Only top-level successful
`undefined` becomes `null`. Raw headers retain their string values without Effect's inspection
redaction; applications decide which headers may be persisted or dehydrated.

Fetched snapshots remain frozen after structural sharing. Global and prefix sharing policies apply
to fetched data; a policy passed to `metadataOptions` overrides them. Mutable envelopes or header
records selected by sharing are copied
before freezing, retaining the selected decoded data reference. The adapter does not freeze
decoded data or caller-supplied `initialData`, hydrated values, or manual cache writes.

Selected observer results and, after execution, manual cache writes use the sharing policy explicitly
passed to `metadataOptions`, or standard deep sharing when it is absent. Inherited global and prefix
sharing policies apply only to fetched metadata snapshots.

A fresh-cache hit from imperative `queryClient.query(newOptions)` retains the Query's existing
options. Install a changed sharing policy through an observer or an actual fetch before relying
on it for later manual writes.

Metadata keys use a `metadata` discriminator and the ordinary request identity. Endpoint prefixes
match every view. Native `select`, `initialData`, skip-token inference, QueryClient hashing defaults,
and cancellation apply to metadata options. Execution failures identify operation `metadata` and
preserve that client mode's full error and service channels. Metadata adds no mutation or infinite
builders and is absent on multipart and streaming endpoints.

The cache retains the decoded value and metadata snapshot, without a response object or open body.
See [Update with an ETag](/effect-api-query/guides/http-metadata/#update-with-an-etag)
for conditional writes.

## Accumulated SSE options

`streamedOptions` accepts native query options, decoded `input` when declared, and:

| Option                    | Contract                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `maxChunks`               | Positive safe integer limiting retained events; omitted means unlimited.                                |
| `refetchMode`             | `reset` (default), `append`, or `replace`.                                                              |
| `sseOptions.maxEventSize` | Positive safe integer limiting pending parser text; defaults to 10 MiB of JavaScript string code units. |

Decoded data is an ordered readonly array. Accumulated elements keep `undefined`; decoded header
wrappers surround each emitted body. Empty completion succeeds. Acquisition and consumption errors
use `EffectHttpApiQueryError` with operation `streamed`, preserving declared event failures,
`Sse.Retry`, `Sse.SseError`, HTTP and Schema errors, and additional client channels.
The caller's runner supplies acquisition and consumption services and receives Query's abort signal.
Cancellation closes the iterator and follows native Query cache reversion.

`streamedKey(input, policy)` accepts the same decoder, retention, and refetch policy; inputless
endpoints use `streamedKey(policy)`. Equivalent defaults have equal keys. Different effective
policies occupy separate entries. Endpoint `key()` selects them all. Decoder controls are excluded
from decoded request input and custom encoders. Declared resume headers remain request identity.

See [Accumulate Values](/effect-api-query/guides/streaming/#accumulate-values).

## Live SSE options

`liveOptions` accepts native query options, declared decoded `input`, and `sseOptions`.
`liveKey(input, { sseOptions })`, or `liveKey({ sseOptions })` for inputless endpoints, includes
normalized decoder policy in its separate `live` identity. Its keys carry the latest decoded value
and the execution error union, including `EffectHttpApiQueryEmptyStreamError`. Live builders
preserve selection, initial-data, and skipped-input inference.

The first emission makes the query successful. Later emissions replace the cached value, and
completion preserves the latest value. Only a top-level `undefined` becomes `null`; declared
header wrappers retain their decoded body and headers. An empty live completion fails with
declaration metadata. Live queries accept no `maxChunks` or accumulated `refetchMode`.

The acquisition and consumption error/service channels, decoder limit validation, iterator cleanup,
and caller-owned reconnection contract match accumulated SSE queries. Input-bearing builders
validate decoder policy even when skipped. Endpoint prefixes match both representations and every
concrete decoder policy. See [Keep the Latest Value](/effect-api-query/guides/streaming/#keep-the-latest-value).

## Pagination

`infiniteOptions` requires `initialPageParam` and `getNextPageParam`. For an input-bearing endpoint,
`input(pageParam)` returns the complete decoded HTTP request for that page. Inputless endpoints
omit `input`. Input-bearing endpoints can pause with `input: skipToken` in the options object;
the direct sentinel form is unavailable.

The initial request determines cache identity. Infinite keys use an `infinite` discriminator, so
they remain separate from ordinary queries for the same request. `infiniteKey(request)` builds
the corresponding key from a complete initial request; `infiniteKey()` serves inputless endpoints.
Keys returned by `infiniteOptions` also retain the inferred page-parameter type for cache reads.

Keep stable filters in the initial request and every page. Change the initial request when those
filters change, and advance cursors through `getNextPageParam`. The input mapper must be
deterministic: the builder evaluates it for the initial key, and execution evaluates it for every
page.

QueryClient stores native `InfiniteData` and owns invalidation and refetching. Selections can
transform consumer data without changing cached pages. Every page preserves the
ordinary HTTP execution contract, including `undefined`-to-`null` normalization, wrapped errors,
and cancellation. See [Pagination](/effect-api-query/guides/pagination/).

## Cache identity and failures

HTTP keys begin with `keyPrefix`, `http`, and the HttpApi identifier, followed by the projected
endpoint path and operation discriminator. Query keys append canonical request identity when the
endpoint has input. `utils.key()` includes the generated root and matches every HTTP descendant.
RPC utilities use a separate `rpc` discriminator. Use the original caller prefix deliberately
when invalidating across both adapters.

Default query preparation synchronously encodes the declared `params`, `query`, `payload`, and
`headers` schemas. The key retains these labels, including when a bodyless method sends its payload
as URL parameters. Preparation uses the endpoint's effective schemas without constructing an HTTP
request or body. The same rule applies to JSON, text, form-urlencoded requests, and requests without
bodies.

Encoded object members whose value is `undefined` are omitted. An encoded `null` stays `null`,
including when Effect's JSON codec produces it from a decoded optional value. Arrays retain their
order; sparse arrays and encoded `undefined` items are rejected. Header field names become lowercase;
equal duplicates collapse and conflicting duplicates fail. Other values follow strict canonical
JSON: finite numbers, plain objects, copied arrays, sorted object properties, cycle rejection, and
deep freezing.

For endpoints with query support, multiple effective payload schemas require a custom encoder,
including alternatives with the same content type. Types enforce this requirement when declarations retain distinct schemas. Runtime
validation also covers alternatives that the declaration types no longer distinguish. Buffered binary
input needs an explicit JSON-safe projection because default keys cannot contain `Uint8Array`. See
[custom key encoders](/effect-api-query/guides/custom-key-encoders/#http-requests).

`EffectHttpApiQueryKeyError` identifies the API, group, endpoint, and method and distinguishes:

| Code                    | Trigger                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `RequestEncodingFailed` | A default request-schema encoder fails.                                   |
| `KeyEncoderFailed`      | A custom encoder throws.                                                  |
| `InvalidKeyValue`       | Encoded identity violates canonical JSON or has conflicting header names. |

These failures occur in `queryKey` or `queryOptions`, before the client runs. Mutation preparation
does not encode a query key; request encoding runs inside the ready client's Effect. Custom encoder
output follows strict JSON and bypasses the default HTTP rules for omitting `undefined` members
and normalizing headers.

Multipart mutation keys contain no request variables or files. `mutationKey()` identifies the
operation, and `key()` retains the endpoint's normal invalidation prefix. Use mutation callbacks
to invalidate the affected read endpoints. Multipart leaves have no query or infinite-query builders.

`EffectHttpApiQueryError` wraps a failed execution `Exit`, identifies the API, group, endpoint,
method, and operation, and preserves its complete Cause. The package adds no concrete request
values to that metadata; upstream Causes can still contain requests, responses, or Schema issue
values. `isEffectHttpApiQueryError` narrows execution errors. Configuration and key preparation
failures use `EffectHttpApiQueryConfigError` and `EffectHttpApiQueryKeyError` respectively.
