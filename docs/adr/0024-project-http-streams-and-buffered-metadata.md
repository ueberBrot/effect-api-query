# Project HTTP streams and buffered metadata into separate cached views

Status: Accepted. Amends [ADR 0020](0020-generate-accumulated-and-live-stream-queries.md),
[ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md), and
[ADR 0023](0023-expose-buffered-multipart-http-mutations.md).

## Context

A query cache needs decoded application values with stable identity. SSE declarations provide
such values; raw transport chunks do not. Buffered responses can also expose status and headers
without retaining a response object or its resources.

## Decision

Generate accumulated and live query builders for endpoints with exactly one SSE success
alternative. A declared `WithHeaders` wrapper projects onto each emission as
`HttpApiSchema.withHeaders({ body: chunk, headers: decodedHeaders })`. Accumulated data is an array
of emissions; live data is the latest emission. Data declarations emit decoded data, while event
declarations preserve their declared fields, event names, and IDs.

Expose opt-in `metadataKey` and `metadataOptions` on query-enabled buffered endpoints. Execute the
ready client with `responseMode: 'decoded-and-response'` and return a frozen readonly envelope:
`{ readonly data: QueryData<DecodedSuccess>; readonly status: number; readonly headers: Readonly<Record<string, string>> }`.
Copy raw enumerable string headers into an ordinary frozen record. Preserve declared decoded
`WithHeaders` values inside `data`; normalize only a top-level successful `undefined` to `null`.
Metadata uses its own operation identity and the ordinary query options' selection, initial-data,
skip-token, and error inference. It adds no metadata mutation or infinite-query methods.

### Supported declarations

Request and success rows compose: the request must permit the view, and the success must have
that representation. HTTP method does not determine cache capability.

| Declared request                                                   | Buffered views                           | SSE views                                | Key-encoder input                               |
| ------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------- | ----------------------------------------------- |
| No params/query/headers/payload                                    | Query, infinite, mutation, metadata      | Accumulated, live                        | None                                            |
| Decoded params/query/headers and JSON/text/form/URL payload        | Query, infinite, mutation, metadata      | Accumulated, live                        | Complete decoded request containers             |
| Serviceful, redacted, binary, or multiple payload alternatives     | Same views with required custom encoding | Same views with required custom encoding | Complete decoded request, without view controls |
| Buffered multipart, including a mixed buffered payload alternative | Mutation only                            | Omitted                                  | None                                            |
| Streaming multipart payload alternative                            | Omitted                                  | Omitted                                  | None                                            |

| Declared success alternatives                        | Generated views                                   | Cached data                                             |
| ---------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| All buffered JSON/text/bytes/no-content alternatives | Ordinary query/infinite/mutation; opt-in metadata | Decoded value; metadata adds status and raw headers     |
| Buffered `WithHeaders(Body, Headers)`                | Same buffered views                               | Decoded wrapper remains intact                          |
| Exactly one `StreamSse({ data })`                    | Accumulated and live                              | Decoded data elements                                   |
| Exactly one `StreamSse({ events })`                  | Accumulated and live                              | Decoded event elements with declared fields             |
| Exactly one `WithHeaders(StreamSse(...), Headers)`   | Accumulated and live                              | Per-emission decoded body and decoded header wrapper    |
| SSE plus any buffered alternative                    | Whole endpoint omitted                            | A single view would misrepresent one successful outcome |
| Multiple streaming alternatives                      | Rejected by Effect endpoint construction          | No endpoint                                             |
| Raw `StreamUint8Array`, wrapped or mixed             | Whole endpoint omitted                            | Application consumes native bytes into its own sink     |

Effect 4.0.0 permits one streaming success alternative with additional buffered alternatives
selected by status/content type. Keep such mixed endpoints omitted until a discriminated contract
can represent every successful outcome.

For ordinary queries and unwrapped live values, successful top-level `undefined` becomes `null`.
Accumulated arrays preserve `undefined` elements. Decoded wrappers and their fields keep their
original representation. Live completion preserves the latest value; completion without an
emission raises `EffectHttpApiQueryEmptyStreamError` with declaration identity. Empty accumulated
completion succeeds with the appropriate retained history.

### View identity

Streaming leaves provide `key`, `streamedKey`, `streamedOptions`, `liveKey`, and `liveOptions`.
Option builders accept `sseOptions?: Sse.DecodeOptions` beside `input`; accumulated builders also
accept `maxChunks` and `refetchMode`. Concrete key builders accept the same policy after decoded
input, or as their only argument for inputless endpoints. Live key policy contains decoder controls
only. Endpoint prefixes select every concrete policy.

Decoded request input and custom key-encoder input contain only declared request parts. Response
mode belongs to the adapter; decoder controls belong to the view. Declared transport headers,
including an application resume cursor, remain request identity input. Middleware-owned identity
belongs in the caller's key prefix. Captured request values remain immutable so identity and
execution describe the same request.

The decoder's `maxEventSize` default is 10 MiB of JavaScript string code units. Absent options,
an empty record, an undefined field, and an explicit default share normalized identity. A
non-default effective limit splits both SSE view keys. Require a positive safe integer and reject
invalid values synchronously with a configuration error. Pass the same normalized value to the
ready client. Accumulated identity also includes effective `maxChunks` and `refetchMode`.

`maxEventSize` limits pending parser text, rather than network bytes or decoded payload size.
A complete event parsed within one input chunk can clear pending state before Effect checks the
limit. A pending event split before its terminator demonstrates the actual control; the adapter
retains that upstream guarantee.

### Failures and resource lifetime

| Phase                                                          | Upstream result                         | Adapter behavior                                                |
| -------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| Request encoding, middleware, status, response-header decoding | Acquisition failure/defect/interruption | HTTP execution error with complete Cause and operation identity |
| SSE parsing, event decoding, reserved declared failure event   | Stream failure/defect/interruption      | Same HTTP execution error                                       |
| `retry:` parser directive                                      | `Sse.Retry`, with duration and event ID | Preserve Cause for application retry/resume policy              |
| Empty successful SSE completion                                | Empty Stream                            | Accumulated empty/history result; live empty-stream error       |
| Query abort                                                    | Interrupted acquisition or consumption  | Native Query reversion, iterator cleanup, no late cache writes  |
| Injected runner rejects                                        | Rejected Promise                        | Preserve rejection unchanged                                    |

Acquisition requires declared encoding, response decoding, error, and middleware services, plus
additional client requirements. Public `HttpApiClient` captures an SSE decoder's services in the
acquisition Context; the resulting Stream advertises `never` residual services. A ready client
must satisfy that public interface, including additional error and service channels.

The supplied ready client and runner own transport, middleware, runtime, and Scope. Acquire and
consume SSE under the caller's runner Context, forward Query's abort signal, and close the iterator
on cancellation. Acquisition and consumption failures preserve the complete Cause in
`EffectHttpApiQueryError` with `streamed`, `live`, or `metadata` operation identity. Independent
interruption is a failure; signal cancellation follows native Query reversion.

Public `Stream.toAsyncIterable` closes its scope and interrupts pending pulls on `return()`.
Returning after the first event and aborting consumption each cancel the Web body once and abort
the transport signal. Upstream transport retains responsibility when acquisition fails before a
usable Stream is returned.

Buffered metadata finishes buffering and decoding before returning its envelope. Cache only that
envelope and header snapshot, never `HttpClientResponse`, Web `Response`, Effect `Headers`, a cookie
collection, or an open body. `Headers.toJSON` applies redaction, so it cannot produce the required
raw snapshot. Decoded data retains its declared representation and ownership. Applications choose
whether raw headers may be persisted or dehydrated.

## Consequences

Raw byte partitions depend on transport chunking: `[1, 2, 3]` can arrive as one chunk or as
`[1, 2]`, `[3]`. Retention by chunk count therefore changes retained bytes despite identical body
content, and native byte Streams retain body lifetime until consumed or closed. Applications own
download accumulation and sinks; explicitly buffered byte schemas keep their existing behavior.

The adapter preserves declared event fields and IDs. Application code owns reconnection,
`Sse.Retry` handling, and resume semantics, including use of its `lastEventId`.

## Evidence

- [`tests/http-view-proof.test.ts`](../../tests/http-view-proof.test.ts) uses public
  `HttpApiTest.groups`, `HttpApiClient.makeWith`, and `HttpClient.make` for decoded SSE, headers,
  reserved failures, retry directives, parser limits, raw byte partitions, and body finalization.
- [`tests/types/http-view-proof.ts`](../../tests/types/http-view-proof.ts) verifies acquisition and
  stream channels, decoded wrappers, additional client requirements, and separated request controls
  with TypeScript 5.9 and the repository compiler.

The upstream contracts come from `HttpApiClient` stream decoding and captured Context,
`HttpApiEndpoint` success validation and client channels, `HttpApiSchema` declarations, `Sse`
decoder controls, and public iterator and HTTP finalization. Reverify them when the exact Effect
peer changes.
