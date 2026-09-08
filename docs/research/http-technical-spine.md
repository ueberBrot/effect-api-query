# HTTP technical spine

The HTTP adapter relies on the Effect HttpApi behavior described below. This reference describes Effect 4.0.0-rc.112, pinned in [the workspace catalog](../../pnpm-workspace.yaml). Source links resolve after installing the repository dependencies. Recheck these assumptions when extending the adapter or updating Effect.

## Decoded requests and responses

[`HttpApiEndpoint.ClientRequest`](../../node_modules/effect/src/unstable/httpapi/HttpApiEndpoint.ts) derives `params`, `query`, `payload`, and `headers` from each schema's `Type`. A declared container stays required even when its fields are optional. An endpoint without request parts accepts `void`. Payload declarations take a schema or schema alternatives; use `Schema.Struct` for an object payload.

The HTTP adapter therefore accepts decoded request fields. It does not call schema constructors or supply RPC constructor defaults. For example, `Schema.NumberFromString` accepts a number at the client call and encodes it as a string on the wire. The request-part encoders in [`HttpApiClient.makeWith`](../../node_modules/effect/src/unstable/httpapi/HttpApiClient.ts) confirm that requests follow this encoding direction.

`HttpApiEndpoint.ClientResponseMode` has three values: `decoded-only`, `decoded-and-response`, and `response-only`. `HttpApiClient.Client.Method` is generic over that mode. Its `Response` conditional uses tuple-wrapped comparisons, so a generic mode union is not a reliable substitute for explicitly selecting a mode. The HTTP adapter derives buffered data from the endpoint success schema's `Type` and supplies `responseMode: 'decoded-only'` after spreading the request. Public request types reserve `responseMode`; runtime callers cannot override it.

[`HttpApiSchema.NoContent`](../../node_modules/effect/src/unstable/httpapi/HttpApiSchema.ts) is a void schema with status 204. The HTTP client decodes it to `undefined`. Query execution converts that value to `null`, while mutation execution preserves it. Buffered `WithHeaders` values retain the wrapper's decoded body and headers.

## Endpoint classification

[`HttpApiEndpoint`](../../node_modules/effect/src/unstable/httpapi/HttpApiEndpoint.ts) exposes success alternatives in `endpoint.success` and payload alternatives in `endpoint.payload`, grouped with their encoding metadata. Inspect every alternative before exposing an endpoint. `getPayloadSchemas` is marked `@internal` and is absent from the published declarations; the adapter traverses the endpoint fields directly.

[`HttpApiSchema`](../../node_modules/effect/src/unstable/httpapi/HttpApiSchema.ts) establishes the matching type and runtime evidence:

| Declaration                      | Type evidence                     | Runtime evidence                                       | HTTP utility result                                  |
| -------------------------------- | --------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Buffered success                 | Success schema `Type`             | Ordinary success schema                                | Expose the endpoint.                                 |
| Streaming success alternative    | `StreamSchema`                    | `~effect/httpapi/HttpApiSchema/Stream` marker          | Omit the complete endpoint.                          |
| Header-wrapped streaming success | `WithHeaders<StreamSchema, ...>`  | `isWithHeaders` and its `schema` field                 | Omit the complete endpoint.                          |
| Buffered multipart payload       | `MultipartTypeId` brand           | Multipart encoding in buffered mode and matching brand | Omit the complete endpoint.                          |
| Streaming multipart payload      | `MultipartStreamTypeId` brand     | Multipart encoding in stream mode and matching brand   | Omit the complete endpoint.                          |
| Contradictory multipart metadata | Types may retain an earlier brand | Encoding and brand disagree                            | Fail the factory with `UnsupportedEndpointMetadata`. |

`asMultipart` and `asMultipartStream` add both a schema brand and encoding metadata. Later annotations can make those disagree. The adapter validates the metadata before constructing the tree, including for an endpoint whose success is already unsupported. A mixed supported/unsupported contract keeps the supported endpoints; a group with no supported endpoints produces no branch.

This agreement applies to literal declarations whose Effect constructors preserve their types. An erased or widened declaration cannot recover the alternatives it discarded. The adapter does not narrow an unsupported alternative out of an exposed endpoint's result.

## Errors, services, and ownership

[`HttpApiClient.Client.Method`](../../node_modules/effect/src/unstable/httpapi/HttpApiClient.ts) includes endpoint errors, middleware server and client errors, `HttpClientError`, `SchemaError`, and additional client error parameter `E`. The adapter wraps that failure union in `EffectHttpApiQueryError` and retains the complete failed `Exit` Cause. Its own metadata identifies the API, group, endpoint, HTTP method, and operation. Underlying Causes can still contain request or response data supplied by Effect.

[`HttpApiEndpoint.ClientServices`](../../node_modules/effect/src/unstable/httpapi/HttpApiEndpoint.ts) includes request encoding services and success/error decoding services. The required runner also includes the ready client's additional service parameter `R`. A custom key encoder supplies synchronous cache identity; it does not provide those execution services. Excluded endpoints contribute no runner requirements.

`HttpApiClient.makeWith` resolves transport and client middleware while building the ready client. Client construction, server handlers, platform services, runtime, and scope remain caller-owned. The utility factory only prepares keys, options, and calls through that ready client.

## Executable evidence

[`HttpApiTest.groups`](../../node_modules/effect/src/unstable/httpapi/HttpApiTest.ts) constructs routes through `HttpApiBuilder`, passes client requests into `HttpRouter`, converts server responses into client responses, and builds the client through `HttpApiClient.makeWith`. This exercises request encoding, routing, handler decoding, response encoding, and client decoding without opening a network listener.

| Evidence                                                                     | What it checks                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Packed HTTP runtime fixture](../../tests/packed-consumer/http-runtime.mts)  | Real QueryClient reads and mutations; numeric schema round trips; caching; forced decoded responses; no-content results; declared errors and full Causes; RPC/HTTP key separation; endpoint, group, root, and caller-prefix invalidation. |
| [Packed HTTP type fixture](../../tests/types/http-contract.ts)               | Literal request and result types; constructor-default rejection; response-mode exclusion; grouping and omission; errors and services; custom encoders; QueryClient inference; select and initialData.                                     |
| [Public HTTP factory tests](../../tests/create-http-api-query-utils.test.ts) | Runtime projection, atomic validation, unsupported alternatives, contradictory metadata, keys, and execution.                                                                                                                             |
| [Packed consumer verifier](../../scripts/verify-packed-consumer.mts)         | Installs the tarball into isolated consumers and runs their compiler and runtime fixtures against the supported peer matrix.                                                                                                              |

In-process routing does not prove network abort behavior or application host routing.

HTTP streams, multipart uploads, and raw response modes remain outside the adapter's supported endpoint contract.
