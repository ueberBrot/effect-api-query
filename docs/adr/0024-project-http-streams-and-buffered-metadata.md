# Project HTTP streams and buffered metadata into separate cached views

Status: Accepted design for the review programme. Implementation follows in issues #104–#106.
Amends [ADR 0020](0020-generate-accumulated-and-live-stream-queries.md),
[ADR 0022](0022-add-buffered-http-utilities-with-separate-key-roots.md), and
[ADR 0023](0023-expose-buffered-multipart-http-mutations.md).

## Decision

An endpoint with exactly one success alternative, whose body is `HttpApiSchema.StreamSse`,
exposes accumulated and live query builders. A declared `WithHeaders` wrapper projects onto each
emitted chunk: `HttpApiSchema.withHeaders({ body: chunk, headers: decodedHeaders })`. Accumulated
query data is an array of those values; live query data is the latest value. Neither view caches a
Stream or a response object. An unwrapped successful live `undefined` becomes `null`; an accumulated
`undefined` element or a declared wrapper containing it keeps its original representation.

Keep the existing `streamedKey`/`streamedOptions` and `liveKey`/`liveOptions` vocabulary. Accept
`sseOptions` beside `input` in option builders and beside the retention policy in concrete key
builders. Decoded request input and custom key-encoder input contain only declared request parts.
Normalize the installed decoder's `maxEventSize` default to 10 MiB of string code units. Its
effective value belongs in both concrete view keys because it changes successful consumption into
a failure for sufficiently large pending events. Accumulated identity also includes effective
`maxChunks` and `refetchMode`. Key-prefix invalidation remains independent of those concrete policies.

Expose `metadataKey`/`metadataOptions` on query-enabled buffered endpoints. Execute the ready
client with `responseMode: 'decoded-and-response'` and return a readonly, frozen outer record
`{ data, status, headers }`, with copied, frozen plain string headers. Normalize decoded `undefined`
to `null` in `data`; preserve any declared decoded `WithHeaders` value intact. Give this view its
own `metadata` operation identity. Ordinary query, infinite-query, and mutation behavior stays as
specified by the existing buffered contracts. Header copying reads raw string entries rather than
Effect's redacting `Headers.toJSON` representation.

The supplied ready client and runner own encoding, middleware, residual services, and transport.
Acquire the SSE value and consume it under the caller's runner Context; forward Query's abort
signal and close the iterator on cancellation. Both acquisition and consumption failures retain
the complete Cause in `EffectHttpApiQueryError`, with `streamed`, `live`, or `metadata` operation
metadata. An independent interruption is a failure; signal cancellation follows native Query
reversion. Empty accumulated completion succeeds with the appropriate retained history. Empty
live completion raises `EffectHttpApiQueryEmptyStreamError` with declaration identity. Runner
rejections pass through unchanged.

## Supported limits

Effect 4.0.0 permits only one streaming success alternative, but it can combine that alternative
with buffered successes selected by status/content type. Such a ready client can return either
buffered data or a Stream. Keep the whole mixed endpoint omitted: assigning a stream view or a
buffered view would misrepresent one successful outcome. Revisit only with an explicitly proved
discriminated contract. Streaming multipart request payloads remain omitted. Buffered multipart
requests remain mutation-only when their successes are buffered; they do not gain SSE query views.

Keep raw `StreamUint8Array` successes omitted, including wrappers and mixed alternatives. Transport
chunks partition the same bytes differently, and `maxChunks` counts transport chunks rather than
bytes or application records. A latest-chunk cache is not a download snapshot. Applications can
consume the native ready client into their own sink or declare an explicitly buffered byte result;
this programme adds no generic download accumulator or sink ownership.

SSE event declarations preserve their declared event fields and IDs; data declarations emit only
decoded data. The adapter does not reconstruct dropped event IDs, reconnect, retry a parser
directive, or invent resume semantics. `Sse.Retry`, its `lastEventId`, and all other failures remain
available in the Cause for an application-owned retry/resume policy.

The [support matrix and proof](../design/http-cached-views.md) record the exact upstream seam,
service channels, resource behavior, and executable evidence behind this decision.
