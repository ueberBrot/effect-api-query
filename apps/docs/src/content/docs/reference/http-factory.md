---
title: HTTP Factory
description: Buffered HTTP utility construction, request input, and ownership.
---

`createHttpApiQueryUtils(api, options)` derives an eager, frozen HTTP utility tree from an Effect
HttpApi and an application-owned ready HttpApiClient. Import it from `effect-api-query`.

Ordinary groups appear as `utils[groupIdentifier][endpointIdentifier]`. Top-level groups place
their endpoints at `utils[endpointIdentifier]`. Identifiers containing dots remain literal
properties. Every retained branch and endpoint has `key()`; buffered endpoints also have
`queryKey`, `queryOptions`, `mutationKey`, and `mutationOptions`.

## Factory options

| Option           | Contract                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `client`         | Ready client for the supplied HttpApi. The application owns its transport, middleware, and lifetime.                        |
| `keyPrefix`      | Non-empty JSON tuple containing any safe tenant, user, or other client-identity partition.                                  |
| `runPromiseExit` | Required when exposed endpoints or the ready client need execution services. Service-free calls default to Effect's runner. |
| `keyEncoders`    | Synchronous encoders keyed first by declaration group identifier, then endpoint identifier, including top-level groups.     |

A key encoder receives the complete decoded HTTP request input and returns `JsonValue`. Request
encoding services, explicit redacted values, and multiple payload alternatives require an encoder.
For alternatives, preserve every result-affecting body and content-type distinction. An encoder does not provide
execution services; the runner remains independently required.

## Request and result contract

HTTP input contains the endpoint's declared `params`, `query`, `headers`, and `payload` parts in
their decoded types. It does not apply RPC constructor defaults. Inputless queries need no input
argument. Mutations receive the same decoded request shape as their variables.

Each declared container stays required even if all its fields are optional: a declared optional
query filter still needs `input: { query: {} }`. A `Schema.FiniteFromString` field accepts a number,
which the ready client encodes as a string. Raw response controls are excluded from query input,
mutation variables, and encoder input.

The adapter forces decoded-only responses. Queries cache a successful `undefined` as `null`;
mutations retain `undefined`. Buffered text stays a string, binary data stays a `Uint8Array`, and
declared response-header wrappers retain their decoded body and headers. Binary and other domain
values gain no automatic SSR serializer; applications own their serialization strategy.

Execution retains declared endpoint errors, middleware server/client errors, Schema errors, HTTP
client errors, and additional ready-client errors in the wrapped Cause's type. Required services
include request encoders, success/error decoders, and residual ready-client services for exposed
endpoints. See [client lifecycle](/effect-rpc-query/concepts/client-lifecycle/#http-clients-and-execution-services)
and [cancellation](/effect-rpc-query/guides/cancellation/#cancel-an-http-query) for runtime ownership.

Any streaming success alternative, including a header-wrapped stream, omits the complete endpoint.
Any multipart request alternative does the same. Groups containing only omitted endpoints disappear.
Factory construction rejects unsafe names, path collisions, and contradictory multipart metadata
before returning a tree. Preserve literal declaration types for corresponding inferred omission.

## Cache identity and failures

HTTP keys begin with `keyPrefix`, `http`, and the HttpApi identifier, followed by the projected
endpoint path and operation discriminator. Query keys append canonical request identity when the
endpoint has input. `utils.key()` includes the generated root and matches every HTTP descendant.
RPC utilities use a separate `rpc` discriminator. Use the original caller prefix deliberately
when invalidating across both adapters.

Default query preparation synchronously encodes the declared `params`, `query`, `payload`, and
`headers` schemas. The key retains these labels, including when a bodyless method sends its payload
as URL parameters. It uses the endpoint's effective schemas, without constructing an HTTP request
or body. JSON, text, form-urlencoded, and requests without bodies follow the same rule.

Encoded object members whose value is `undefined` are omitted. An encoded `null` stays `null`,
including when Effect's JSON codec produces it from a decoded optional value. Arrays retain their
order; sparse arrays and encoded `undefined` items are rejected. Header field names become lowercase;
equal duplicates collapse and conflicting duplicates fail. Other values follow strict canonical
JSON: finite numbers, plain objects, copied arrays, sorted object properties, cycle rejection, and
deep freezing.

Multiple effective payload schemas require a custom encoder, including alternatives with the same
content type. Static enforcement applies where declaration types retain distinct schemas; runtime
validation covers alternatives erased by annotation types. Buffered binary input needs an explicit
JSON-safe projection because default keys cannot contain `Uint8Array`. See
[custom key encoders](/effect-rpc-query/guides/custom-key-encoders/#http-requests).

`EffectHttpApiQueryKeyError` identifies the API, group, endpoint, and method and distinguishes:

| Code                    | Trigger                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `RequestEncodingFailed` | A default request-schema encoder fails.                                   |
| `KeyEncoderFailed`      | A custom encoder throws.                                                  |
| `InvalidKeyValue`       | Encoded identity violates canonical JSON or has conflicting header names. |

These failures occur in `queryKey` or `queryOptions`, before client invocation. Mutation preparation
does not encode a query key; request encoding runs inside the ready client's Effect. Custom encoder
output follows strict JSON without default HTTP omission or header normalization.

`EffectHttpApiQueryError` wraps a failed execution `Exit`, identifies the API, group, endpoint,
method, and operation, and preserves its complete Cause. The package adds no concrete request
values to that metadata; upstream Causes can still contain requests, responses, or Schema issue
values. `isEffectHttpApiQueryError` narrows execution errors. Configuration and key preparation
failures use `EffectHttpApiQueryConfigError` and `EffectHttpApiQueryKeyError` respectively.

The [packed HTTP consumer](https://github.com/ueberBrot/effect-rpc-query/blob/main/tests/packed-consumer/http-runtime.mts)
exercises the real HTTP encoding, routing, and decoding pipeline. The
[type contract](https://github.com/ueberBrot/effect-rpc-query/blob/main/tests/types/http-contract.ts)
checks request input, result inference, services, and endpoint omission.
The [semantic-key tests](https://github.com/ueberBrot/effect-rpc-query/blob/main/tests/http-semantic-keys.test.ts)
exercise request formats, alternative payload identity, normalization, and cache reuse.
