---
title: HTTP Factory
description: HTTP factory options, decoded request input, response data, and cache keys.
---

`createHttpApiQueryUtils(api, options)` builds and freezes an HTTP utility tree when called. It
uses an Effect HttpApi and a ready HttpApiClient whose lifetime your application manages. Import
it from `effect-api-query`.

Start with the [HTTP Quick Start](/effect-api-query/getting-started/http-quick-start/).
[HTTP Builders](/effect-api-query/reference/http-builders/) specifies each generated option and key.

Ordinary groups project to `utils[groupIdentifier][endpointIdentifier]`; top-level groups
project endpoints to `utils[endpointIdentifier]`. Dots remain literal properties. Every retained
branch and endpoint has `key()`.

| Endpoint                                   | Builders beside `key()`                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| Buffered without multipart                 | `queryKey/Options`, `metadataKey/Options`, `infiniteKey/Options`, `mutationKey/Options` |
| Any buffered multipart payload alternative | `mutationKey`, `mutationOptions`                                                        |
| Exactly one SSE success, no multipart      | `streamedKey/Options`, `liveKey/Options`                                                |

Any multipart alternative makes a buffered endpoint mutation-only, including mixed plain and
multipart alternatives. HTTP method does not determine the builder for query-enabled endpoints.

## Factory options

| Option           | Contract                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `client`         | Ready client for the supplied HttpApi. The application owns its transport, middleware, and lifetime.                        |
| `keyPrefix`      | Non-empty JSON tuple containing any safe tenant, user, or other client-identity partition.                                  |
| `runPromiseExit` | Required when exposed endpoints or the ready client need execution services. Service-free calls default to Effect's runner. |
| `keyEncoders`    | Synchronous encoders keyed first by declaration group identifier, then endpoint identifier, including top-level groups.     |

A key encoder receives the complete decoded HTTP request input and returns `JsonValue`. For endpoints
with query support, request encoding services, opaque encoding middleware, explicit redacted
values, and multiple payload alternatives require an encoder. Opaque middleware requires an
encoder even when it is synchronous and service-free; TypeScript may not detect that requirement,
so factory construction also validates it at runtime.
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

Query options retain the decoded request for execution. Keep captured values unchanged; see
[Data Normalization](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
for the distinction between immutable keys and caller-owned input.

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

A single SSE success, including `WithHeaders(StreamSse(...), ...)`, supports accumulated and live queries.
Raw byte streams and mixed buffered/SSE success alternatives omit the complete endpoint.
Any streaming multipart request alternative does the same. SSE endpoints with buffered multipart
payload alternatives are also omitted. Buffered multipart alternatives retain
the endpoint's mutation builders. Groups containing only omitted endpoints disappear.
Factory construction rejects unsafe names, path collisions, and contradictory multipart metadata
before returning a tree. Preserve literal declaration types so the inferred tree omits the same
endpoints.
