# HTTP cached-view contract and design proof

This is the implementation contract for issues #104–#106 under spec #95. The retained proof uses
the already installed Effect 4.0.0 public exports. It does not install dependencies or add shipped
features. [ADR 0024](../adr/0024-project-http-streams-and-buffered-metadata.md) records the decision.

## Input and output support matrix

The request and success rows compose: a request must permit a particular view and its success
must have the corresponding representation. HTTP method does not determine cache capability.

| Declared request                                                   | Ordinary buffered views                        | SSE query views                                | Key-encoder input                                         |
| ------------------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| No params/query/headers/payload                                    | Query, infinite, mutation, metadata            | Accumulated, live                              | None                                                      |
| Decoded params/query/headers and JSON/text/form/URL payload        | Query, infinite, mutation, metadata            | Accumulated, live                              | Complete decoded request containers                       |
| Serviceful, redacted, binary, or multiple payload alternatives     | Same views after required safe custom encoding | Same views after required safe custom encoding | Complete decoded request; never response/decoder controls |
| Buffered multipart, including a mixed buffered payload alternative | Mutation only                                  | Omitted                                        | None; FormData is not query identity                      |
| Streaming multipart payload alternative                            | Omitted                                        | Omitted                                        | None                                                      |

Request values captured by builders must remain immutable. Identity and execution must describe the
same request. Response mode belongs to the adapter, and `sseOptions` belongs to the view builder.
Native transport headers declared as request input, including an application resume cursor, remain
request identity input. Middleware-owned identity must be partitioned in the caller's key prefix.

| Declared success alternatives                        | Generated view                                                                      | Cached query data                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| All buffered JSON/text/bytes/no-content alternatives | Existing ordinary query/infinite/mutation; opt-in metadata for query-enabled inputs | Existing decoded value; metadata `{ data, status, headers }`                                 |
| Buffered `WithHeaders(Body, Headers)`                | Same buffered views                                                                 | Declared decoded wrapper remains intact; metadata adds raw header/status snapshot outside it |
| Exactly one `StreamSse({ data })`                    | Accumulated and live only                                                           | Decoded data elements; latest decoded data for live                                          |
| Exactly one `StreamSse({ events })`                  | Accumulated and live only                                                           | Declared decoded event elements, including declared IDs/event names                          |
| Exactly one `WithHeaders(StreamSse(...), Headers)`   | Accumulated and live only                                                           | Per-emission `withHeaders({ body: decodedChunk, headers: decodedHeaders })`                  |
| SSE plus any buffered alternative                    | Whole endpoint omitted                                                              | No truthful single query-data shape has been selected                                        |
| Multiple streaming alternatives                      | Rejected by installed Effect endpoint construction                                  | No endpoint                                                                                  |
| Raw `StreamUint8Array`, wrapped or mixed             | Whole endpoint omitted                                                              | Application consumes native bytes into its own sink                                          |

For ordinary query data and live values, successful top-level `undefined` becomes `null`.
Accumulated arrays preserve `undefined` elements. Metadata normalizes its decoded `data` field;
it leaves a decoded wrapper and its fields unchanged. Live completion preserves the latest value;
completion without any emission is a distinct package empty-stream error.

## Concrete interface

Streaming leaves provide `key()`, `streamedKey(...)`, `streamedOptions(...)`, `liveKey(...)`, and
`liveOptions(...)`. Query-enabled buffered leaves additionally provide `metadataKey(...)` and
`metadataOptions(...)`. The metadata result shape is
`{ readonly data: QueryData<DecodedSuccess>; readonly status: number; readonly headers: Readonly<Record<string, string>> }`.
Metadata gets the normal unary options' native selection, initial-data, skip-token, and error
inference with this result shape. It does not create metadata mutation or infinite-query methods.

Option builders accept `sseOptions?: Sse.DecodeOptions` alongside `input`, with accumulated
`maxChunks` and `refetchMode` alongside it. Concrete key builders accept the same policy object
after decoded input, or as their only argument for inputless endpoints. Live concrete key policy
contains only decoder controls. Prefix keys continue to select every policy for that endpoint.

The installed decoder has one control, `maxEventSize`. Absent options, an empty options record,
an undefined field, and the explicit 10 MiB default must have identical normalized identity. A
non-default effective limit splits both SSE views. Require a positive safe integer and reject
invalid values synchronously with a configuration error. This protects finite, JSON-safe view
identity. The same normalized value must be passed to the ready client.

`maxEventSize` limits pending parser text, measured in JavaScript string code units. It is neither
a network byte limit nor a maximum decoded payload size: in installed Effect, a complete event
that is parsed within one input chunk can clear pending state before that limit check. The proof
deliberately splits a pending event before its terminator to demonstrate the control. No adapter
parser replacement or stronger size guarantee is added.

## Failures, services, and resource lifetime

| Phase                                                               | Public upstream result/channel                            | Adapter contract                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Request encoding, middleware, HTTP status, response-header decoding | Ready-client Effect failure/defect/interruption           | HTTP execution error with untouched Cause and declaration/operation metadata |
| SSE parsing, event decoding, reserved declared failure event        | Stream failure/defect/interruption                        | Same HTTP execution error; acquisition alone is not successful consumption   |
| `retry:` parser directive                                           | `Sse.Retry` failure, including duration and last event ID | Preserve Cause; application selects retry/resume behavior                    |
| Empty SSE body that completes successfully                          | Empty upstream Stream                                     | Accumulated empty/history result; live empty-stream error                    |
| Query abort                                                         | Interrupted acquisition or iterator consumption           | Native Query cancellation/reversion; finalize iterator, no late cache writes |
| Injected runner rejects                                             | Rejected Promise                                          | Preserve rejection unchanged                                                 |

The generated client acquisition Effect requires declared request encoding and response decoding
services, declared error/middleware services, and any additional client requirements. A serviceful
SSE event decoder is captured in the acquisition Context by public `HttpApiClient`; its resulting
Stream advertises `never` residual services. The retained compile fixture proves those channels,
including a caller's additional error/service types and declared stream errors. A caller-supplied
ready client must satisfy that public interface; the adapter does not erase requirements to make
construction compile.

Public `Stream.toAsyncIterable` closes its scope and interrupts pending pulls on `return()`.
The proof observes one Web body cancellation and an aborted transport signal both when returning
after the first event and when aborting consumption. These observations do not transfer ownership
of the acquired client, runtime, or application Scope to the adapter. Upstream transport remains
responsible for resources when acquisition fails before a usable Stream is returned.

Buffered metadata uses `decoded-and-response` so normal buffering/decoding finishes before the
metadata record is returned. Copy raw enumerable string entries into an ordinary frozen record;
never cache `HttpClientResponse`, Web `Response`, Effect `Headers`, cookies, or an open body. Do not
use `Headers.toJSON`, which applies redaction rather than copying raw strings. Decoded data retains
its declared representation and ownership; freeze only the new metadata envelope and plain header
snapshot. Applications choose whether those headers may be persisted or dehydrated.

Raw-byte proof observations show `[1, 2, 3]` returned as one transport chunk and as two chunks
`[1, 2]`, `[3]`. Retention by chunk count therefore changes which bytes remain despite identical
full-body content. Native byte Streams also retain transport/body lifetime until consumed or
closed. The programme deliberately limits generated streaming views to schema-decoded SSE
application records. Existing explicitly buffered byte schemas keep their existing behavior.

## Executable evidence

- [`tests/http-view-proof.test.ts`](../../tests/http-view-proof.test.ts) uses `HttpApiTest.groups`
  with real handlers for finite SSE/event/header/error round trips, and public
  `HttpApiClient.makeWith`/`HttpClient.make` for controlled wire and body-lifecycle observations.
- [`tests/types/http-view-proof.ts`](../../tests/types/http-view-proof.ts) compiles upstream
  acquisition, stream, decoded-wrapper, additional-client, and separated-request contracts. It
  passes with installed TypeScript 5.9.3 and 7.0.2 without a registry installation.
- `vp test tests/http-view-proof.test.ts` runs the focused runtime proof. Implementation tickets
  must additionally verify their shipped builders through the agreed installed-tarball seam.

Upstream evidence is available in the installed public `effect/http-api`, `effect/http`,
`effect/encoding`, and `effect` exports. Source inspection used `HttpApiClient`'s stream decoding
and captured Context, `HttpApiEndpoint`'s success validation/client channels, `HttpApiSchema`'s
stream/wrapper declarations, `Sse`'s decoder controls, and the public iterator/HTTP finalization
contracts. Re-run this evidence when the coordinated Effect patch changes.
