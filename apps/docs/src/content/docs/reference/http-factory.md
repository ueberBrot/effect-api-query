---
title: HTTP Factory
description: HTTP factory options, decoded request input, response data, and cache keys.
---

`createHttpApiQueryUtils(api, options)` derives an eager, frozen HTTP utility tree from an Effect
HttpApi and an application-owned ready HttpApiClient. Import it from `effect-api-query`.

For a step-by-step example, see [HTTP Queries and Mutations](/effect-api-query/guides/http-queries-and-mutations/).

Ordinary groups appear as `utils[groupIdentifier][endpointIdentifier]`. Top-level groups place
their endpoints at `utils[endpointIdentifier]`. Identifiers containing dots remain literal
properties. Every retained branch and endpoint has `key()`; buffered endpoints also have
`queryKey`, `queryOptions`, `mutationKey`, `mutationOptions`, `infiniteKey`, and `infiniteOptions`.
Every buffered endpoint exposes all these builders regardless of HTTP method; the application
chooses whether a call is a query or mutation.

## Query options

Ordinary options work with native query, suspense, and prefetch hooks and QueryClient operations.
Callbacks retain the decoded result, complete failure union, and request types. `select` changes
observer data; data-tagged keys retain the underlying cache data and error types. Defined and
possibly undefined `initialData` preserve TanStack's corresponding hook overloads.

Applicable TanStack options pass through. The package owns the key, function, and query hash
fields, including the precomputed `queryHash`, and consumes its `input` before returning options.

Input-bearing `queryOptions` accepts a complete request, `queryOptions(skipToken)`, or
`queryOptions({ input: skipToken, ...options })`. Import `skipToken` from `effect-api-query` or
TanStack. Skipping preserves caller options and returns the exact sentinel as `queryFn`, with the
operation-level key and no request identity. It performs no request encoding or client call.
Supplied initial data remains available, but native skipped hook data stays possibly undefined.

Inputless builders, key builders, and mutations reject `skipToken`. A skipped function cannot run
through manual refetch; supply valid input or use `enabled: false` with a complete request when
manual execution is required. Native suspense and prefetch-only hooks reject skipped options.

## Pagination

`infiniteOptions` requires `initialPageParam` and `getNextPageParam`. For an input-bearing endpoint,
`input(pageParam)` returns the complete decoded HTTP request for that page. Inputless endpoints
omit `input`. Input-bearing endpoints can pause with `input: skipToken` in the options object;
the direct sentinel form is unavailable.

The initial request supplies cache identity. Infinite keys use an `infinite` discriminator, so
they remain separate from ordinary queries for the same request. `infiniteKey(request)` builds
the corresponding key from a complete initial request; `infiniteKey()` serves inputless endpoints.
Options-generated keys also retain the inferred page-parameter type for cache reads.

The caller keeps stable filters in the initial request and every page, changes the initial request
when those filters change, and advances cursors through `getNextPageParam`. Keep the input mapper
deterministic: options construction evaluates it for the initial key, and execution evaluates it
for every page. QueryClient stores native `InfiniteData` and owns invalidation and refetching.
Selections can transform observer data without changing cached pages. Every page preserves the
ordinary HTTP execution contract, including `undefined`-to-`null` normalization, wrapped errors,
and cancellation. See [Load pages](/effect-api-query/guides/http-queries-and-mutations/#load-pages).

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
endpoints. Compatible custom clients retain errors and residual services from their decoded-only
call signatures; raw-response overloads contribute neither.
See [client lifecycle](/effect-api-query/concepts/client-lifecycle/#http-clients-and-execution-services)
and [cancellation](/effect-api-query/guides/cancellation/#cancel-an-http-query) for runtime ownership.

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
[custom key encoders](/effect-api-query/guides/custom-key-encoders/#http-requests).

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
