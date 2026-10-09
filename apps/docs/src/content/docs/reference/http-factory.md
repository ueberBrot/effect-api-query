---
title: HTTP Factory
description: HTTP factory options, decoded request input, response data, and cache keys.
---

`createHttpApiQueryUtils(api, options)` builds and freezes an HTTP utility tree when called. It
uses an Effect HttpApi and a ready HttpApiClient whose lifetime your application manages. Import
it from `effect-api-query`.

For a step-by-step example, see [HTTP Queries and Mutations](/effect-api-query/guides/http-queries-and-mutations/).

Ordinary groups appear as `utils[groupIdentifier][endpointIdentifier]`. Top-level groups place
their endpoints at `utils[endpointIdentifier]`. Identifiers containing dots remain literal
properties. Every retained branch and endpoint has `key()`; buffered endpoints without multipart have
`queryKey`, `queryOptions`, `metadataKey`, `metadataOptions`, `mutationKey`, `mutationOptions`,
`infiniteKey`, and `infiniteOptions`.
An endpoint with any buffered multipart payload alternative exposes only `key`, `mutationKey`, and
`mutationOptions`, even when it also accepts plain payload alternatives. This classification applies
regardless of HTTP method; applications choose the builder for endpoints with query support.
An endpoint with exactly one SSE success and no multipart payload exposes `key`, `streamedKey`,
and `streamedOptions`.

## Factory options

| Option           | Contract                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `client`         | Ready client for the supplied HttpApi. The application owns its transport, middleware, and lifetime.                        |
| `keyPrefix`      | Non-empty JSON tuple containing any safe tenant, user, or other client-identity partition.                                  |
| `runPromiseExit` | Required when exposed endpoints or the ready client need execution services. Service-free calls default to Effect's runner. |
| `keyEncoders`    | Synchronous encoders keyed first by declaration group identifier, then endpoint identifier, including top-level groups.     |

A key encoder receives the complete decoded HTTP request input and returns `JsonValue`. For endpoints
with query support, request encoding services, explicit redacted values, and multiple payload
alternatives require an encoder.
For alternatives, preserve every body and content-type distinction that affects the result. An
encoder does not provide execution services; the runner remains independently required.
Multipart mutation-only endpoints require no encoder and reject configured encoder entries.

## Request and result contract

HTTP input contains the endpoint's declared `params`, `query`, `headers`, and `payload` parts in
the ready client's request types. Params, query, headers, and ordinary payloads use decoded values;
multipart payloads use `FormData`. Mixed plain and buffered multipart alternatives preserve the
upstream client request union. Build multipart fields and files explicitly; the adapter forwards
your `FormData` to the ready client. It does not apply RPC constructor defaults. Inputless queries
need no input argument. Mutations receive the same complete request shape as their variables.

Each declared container stays required even if all its fields are optional: a declared optional
query filter still needs `input: { query: {} }`. A `Schema.FiniteFromString` field accepts a number,
which the ready client encodes as a string. Raw response controls are excluded from query input,
mutation variables, and encoder input.

Ordinary queries and mutations use decoded-only responses. Queries cache a successful `undefined` as `null`;
mutations retain `undefined`. Buffered text stays a string, binary data stays a `Uint8Array`, and
declared response-header wrappers retain their decoded body and headers. Applications own the
serialization strategy for binary and other domain values; the package supplies no automatic SSR
serializer.

Execution retains declared endpoint errors, middleware server/client errors, Schema errors, HTTP
client errors, and additional ready-client errors in the wrapped Cause's type.

Required services include those needed by request encoders, success and error decoders, and the
ready client for exposed endpoints. Compatible custom clients retain the errors and remaining
service requirements of their decoded-only and decoded-and-response call signatures;
response-only overloads contribute neither.
See [client lifecycle](/effect-api-query/concepts/client-lifecycle/#http-clients-and-execution-services)
and [cancellation](/effect-api-query/guides/cancellation/#cancel-an-http-query) for runtime ownership.

A single SSE success, including `WithHeaders(StreamSse(...), ...)`, supports accumulated queries.
Raw byte streams and mixed buffered/SSE success alternatives omit the complete endpoint.
Any streaming multipart request alternative does the same. SSE endpoints with buffered multipart
payload alternatives are also omitted. Buffered multipart alternatives retain
the endpoint's mutation builders. Groups containing only omitted endpoints disappear.
Factory construction rejects unsafe names, path collisions, and contradictory multipart metadata
before returning a tree. Preserve literal declaration types so the inferred tree omits the same
endpoints.

## Query options

Ordinary options work with native query, suspense, and prefetch hooks and QueryClient operations.
Callbacks retain the decoded result, complete failure union, and request types. `select` changes
observer data; data-tagged keys retain the underlying cache data and error types. The type of
`initialData`, whether defined or possibly undefined, preserves the corresponding TanStack hook
overload.

Applicable TanStack options pass through. The package owns the key and function and removes
`input` before returning options. QueryClient global and prefix defaults own hashing. Builders
reject per-call `queryKeyHashFn` and `queryHash` with `EffectHttpApiQueryConfigError` code
`UnsupportedQueryHash`.

Input-bearing `queryOptions` accepts a complete request, `queryOptions(skipToken)`, or
`queryOptions({ input: skipToken, ...options })`. Import `skipToken` from `effect-api-query` or
TanStack. Skipping preserves caller options and returns the exact sentinel as `queryFn`, with the
operation-level key and no request identity. It performs no request encoding or client call.
Supplied initial data remains available, but native skipped hook data stays possibly undefined.

Inputless builders, key builders, and mutations reject `skipToken`. A skipped function cannot run
through manual refetch; supply valid input or use `enabled: false` with a complete request when
manual execution is required. Native suspense and prefetch-only hooks reject skipped options.

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

Fetched snapshots remain frozen after native structural sharing, while preserving global, prefix,
and per-call sharing policies. Mutable envelopes or header records selected by sharing are copied
before freezing, retaining the selected decoded data reference. The adapter does not freeze
decoded data or caller-supplied `initialData`, hydrated values, or manual cache writes.

Metadata keys use a `metadata` discriminator and the ordinary request identity. Endpoint prefixes
match every view. Native `select`, `initialData`, skip-token inference, QueryClient hashing defaults,
and cancellation apply to metadata options. Execution failures identify operation `metadata` and
preserve that client mode's full error and service channels. Metadata adds no mutation or infinite
builders and is absent on multipart and streaming endpoints.

The cache retains the decoded value and metadata snapshot, without a response object or open body.
See [Update with an ETag](/effect-api-query/guides/http-queries-and-mutations/#update-with-an-etag)
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

See [Retain SSE events](/effect-api-query/guides/http-queries-and-mutations/#retain-sse-events).

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
transform observer data without changing cached pages. Every page preserves the
ordinary HTTP execution contract, including `undefined`-to-`null` normalization, wrapped errors,
and cancellation. See [Load pages](/effect-api-query/guides/http-queries-and-mutations/#load-pages).

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
