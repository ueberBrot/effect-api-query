---
title: HTTP Factory
description: HTTP factory options, decoded request input, response data, and cache keys.
---

Import `createHttpApiQueryUtils` from `@ueberbrot/effect-api-query`. Pass the HttpApi declaration and its acquired HttpApiClient to build a frozen tree. Your app owns the client's lifetime.

Follow the [HTTP quick start](/effect-api-query/getting-started/http-quick-start/) for setup. See [HTTP builders](/effect-api-query/reference/http-builders/) for each key and option.

Access an ordinary endpoint with `utils[groupIdentifier][endpointIdentifier]`. For a top-level group, use `utils[endpointIdentifier]`. Keep dots in names. Call `key()` on any retained branch or endpoint.

| Endpoint | Builders beside `key()` |
| --- | --- |
| Buffered without multipart | `queryKey/Options`, `metadataKey/Options`, `infiniteKey/Options`, `mutationKey/Options` |
| Any buffered multipart payload alternative | `mutationKey`, `mutationOptions` |
| Exactly one SSE or NDJSON success, no multipart | `streamedKey/Options`, `liveKey/Options` |

A buffered multipart alternative makes an endpoint mutation-only even if it also takes plain input. Other buffered endpoints can build queries and mutations regardless of HTTP method.

## Factory options

| Option | Contract |
| --- | --- |
| `client` | Ready client for the supplied HttpApi. The application owns its transport, middleware, and lifetime. |
| `keyPrefix` | Optional non-empty JSON tuple of safe identity values. Omit it to use the empty namespace for the HTTP API. |
| `runtime` | Pass a ManagedRuntime with no layer initialization error, or a compatible runner function. Supply it when execution needs services. |
| `keyEncoders` | Synchronous encoders keyed first by declaration group identifier, then endpoint identifier, including top-level groups. |

An encoder receives the full decoded request and returns `JsonValue`. For a query-capable endpoint, supply one for encoding services, opaque middleware, redacted values, or multiple payload alternatives. Runtime validation catches opaque middleware that TypeScript misses, including synchronous middleware. Preserve every body and content-type difference that affects responses.

Some payload alternatives share one decoded type. If TypeScript merges those types, the factory still requires an encoder. Default key encoding follows the HTTP parse options for each request part.

Supply execution services through the runner. Leave buffered multipart endpoints out of the encoder map because they only support mutations.

## Request and result contract

Supply the declared decoded `params`, `query`, `headers`, and `payload`. If the payload is multipart, build `FormData` and pass it to the mutation. Mixed buffered alternatives keep the client's request union. Pass any HTTP defaults explicitly.

Call an inputless query without input. Pass the full request as mutation variables.

Supply every declared request object, even if its fields are optional. For no query filters, pass `input: { query: {} }`. A `Schema.FiniteFromString` field takes a decoded number. The client encodes it as a string. Keep response controls out of requests and encoder inputs.

Keep retained request values unchanged. See [input ownership](/effect-api-query/concepts/data-normalization/#keep-captured-inputs-unchanged).

Ordinary queries and mutations return decoded data. A query caches `null` for successful `undefined`, while a mutation keeps `undefined`. Text stays a string and binary data stays a `Uint8Array`. Declared wrappers preserve decoded bodies and headers. Use [contract hydration codecs](/effect-api-query/guides/hydrate-query-views/) for rich SSR values.

The Effect Cause retains declared endpoint, middleware, Schema, transport, and additional ready-client errors.

Supply services used by endpoint request encoders, decoders, and the ready client. Compatible custom clients preserve remaining services and errors from decoded-only and decoded-and-response modes. Response-only modes do not contribute. See [execution services](/effect-api-query/concepts/client-lifecycle/#http-clients-and-execution-services) and [HTTP cancellation](/effect-api-query/guides/cancellation/#cancel-an-http-query).

An endpoint with a single SSE or NDJSON success supports accumulated and live views, including a declared `WithHeaders` wrapper. Effect decodes emissions. The factory skips raw byte response streams, upgrades, mixed buffered and streamed successes, and any streaming request payload. It also skips streamed successes with buffered multipart input. Groups with no supported endpoints disappear.

The factory rejects unsafe names, collisions, and conflicting multipart metadata before building any leaf. It freezes branches immediately and builds frozen leaves on first access. Keep literal declaration types so TypeScript can infer supported paths.
