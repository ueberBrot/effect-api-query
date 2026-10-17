---
title: HTTP Factory
description: HTTP factory options, decoded request input, response data, and cache keys.
---

`createHttpApiQueryUtils(api, options)` builds and freezes an HTTP utility tree from an Effect
HttpApi and a ready HttpApiClient. The application manages the client's lifetime.
The factory is exported from `@ueberbrot/effect-api-query`.

The [HTTP Quick Start](/effect-api-query/getting-started/http-quick-start/) shows factory setup.
[HTTP Builders](/effect-api-query/reference/http-builders/) defines each generated option and key.

Ordinary groups project to `utils[groupIdentifier][endpointIdentifier]`. Top-level groups project
endpoints to `utils[endpointIdentifier]`. Dots remain literal properties.
Every retained branch and endpoint has `key()`.

| Endpoint                                   | Builders beside `key()`                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| Buffered without multipart                 | `queryKey/Options`, `metadataKey/Options`, `infiniteKey/Options`, `mutationKey/Options` |
| Any buffered multipart payload alternative | `mutationKey`, `mutationOptions`                                                        |
| Exactly one SSE success, no multipart      | `streamedKey/Options`, `liveKey/Options`                                                |

Any multipart alternative makes a buffered endpoint mutation-only, even if the endpoint also
accepts plain payloads. For query-enabled endpoints, the HTTP method does not determine the builder.

## Factory options

| Option           | Contract                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `client`         | Ready client for the supplied HttpApi. The application owns its transport, middleware, and lifetime.                        |
| `keyPrefix`      | Non-empty JSON tuple containing any safe tenant, user, or other client-identity partition.                                  |
| `runPromiseExit` | Required when exposed endpoints or the ready client need execution services. Service-free calls default to Effect's runner. |
| `keyEncoders`    | Synchronous encoders keyed first by declaration group identifier, then endpoint identifier, including top-level groups.     |

A key encoder receives the complete decoded HTTP request input and returns `JsonValue`.
For endpoints with query support, an encoder is required for request encoding services, opaque
encoding middleware, explicit redacted values, or multiple payload alternatives.
Opaque middleware requires an encoder even when it is synchronous and service-free.
TypeScript cannot always detect that requirement, so factory construction also validates it at runtime.
For payload alternatives, the encoder must preserve every body and content-type distinction that
affects the result.

An encoder does not provide execution services. The runner remains independently required.
Multipart mutation-only endpoints require no encoder and reject configured encoder entries.

## Request and result contract

HTTP input contains the endpoint's declared `params`, `query`, `headers`, and `payload` parts in
the ready client's request types. Params, query, headers, and ordinary payloads use decoded values.
Multipart payloads use `FormData`. Mixed plain and buffered multipart alternatives preserve the
upstream client request union. The caller explicitly builds multipart fields and files.
The adapter forwards the supplied `FormData` to the ready client.
HTTP builders do not apply RPC constructor defaults.

Inputless queries need no input argument. Mutations receive the same complete request shape as
their variables.

Each declared container stays required even if all its fields are optional.
A declared optional query filter still needs `input: { query: {} }`.
A `Schema.FiniteFromString` field accepts a number that the ready client encodes as a string.
Query input, mutation variables, and encoder input exclude raw response controls.

Query options retain the decoded request for execution. Captured values must stay unchanged.
See
[Data Normalization](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged)
for the distinction between immutable keys and caller-owned input.

Ordinary queries and mutations use decoded-only responses. Queries cache a successful `undefined`
as `null`. Mutations retain `undefined`. Buffered text stays a string, and binary data stays a
`Uint8Array`. Declared response-header wrappers retain their decoded body and headers.
Applications own serialization for binary and other domain values. The package supplies no
automatic SSR serializer.

The wrapped Cause's type retains declared endpoint errors, server and client middleware errors,
Schema errors, HTTP client errors, and additional ready-client errors.

Required services include those needed by request encoders, success and error decoders, and the
ready client for exposed endpoints. Compatible custom clients retain the errors and remaining
services from their decoded-only and decoded-and-response call signatures.
Response-only overloads contribute neither errors nor service requirements.
See [client lifecycle](/effect-api-query/concepts/client-lifecycle/#http-clients-and-execution-services)
and [cancellation](/effect-api-query/guides/cancellation/#cancel-an-http-query) for runtime ownership.

A single SSE success, including `WithHeaders(StreamSse(...), ...)`, supports accumulated and live
queries. The factory omits endpoints with raw byte streams or mixed buffered and SSE success
alternatives. It also omits any endpoint with a streaming multipart request alternative, and SSE
endpoints with buffered multipart payload alternatives. On buffered endpoints, multipart
alternatives retain mutation builders. Groups with only omitted endpoints disappear.

Factory construction rejects unsafe names, path collisions, and contradictory multipart metadata
before it returns a tree. Literal declaration types let the inferred tree omit the same endpoints.
