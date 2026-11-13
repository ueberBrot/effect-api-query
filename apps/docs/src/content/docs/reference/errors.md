---
title: Errors
description: Configuration, key-generation, and execution errors for RPC and HTTP.
---

## `EffectRpcQueryConfigError`

Invalid factory or builder configuration throws this error synchronously. Stream execution also rejects incompatible QueryClient hashing. The error's `code` is one of:

- `InvalidMaxChunks`: retention is neither a positive safe integer nor `"unbounded"`.
- `InvalidRefetchMode`: a streamed-query mode is not `reset`, `append`, or `replace`.
- `InvalidKeyPrefix`
- `InvalidRpcPath`
- `RpcPathCollision`
- `MissingKeyEncoder`
- `UnknownKeyEncoder`
- `UnsupportedQueryHash`: a builder received `queryKeyHashFn` or `queryHash`, or stream execution found either a default hash inconsistent with its key hasher or a conflicting cached identity.

The error can also expose `rpcTag`, `path`, and an underlying `cause`.

## `EffectRpcQueryKeyError`

Payload-specific key preparation throws this error synchronously. The error exposes `rpcTag`, `cause`, and one of these codes:

- `PayloadConstructionFailed`
- `PayloadEncodingFailed`
- `KeyEncoderFailed`
- `InvalidKeyValue`

## `EffectRpcQueryError<E>`

This error wraps a failed `Exit` from the RPC runner. It exposes `rpcTag`, `operation`, and the full `Cause.Cause<E>`. The runtime guard `isEffectRpcQueryError(value)` uses `instanceof` within one JavaScript realm. The operation is `query`, `infinite`, or `mutation`.

Streaming failures use the same class. They preserve RPC, stream, middleware, client, defect, and interruption Causes, with operation `streamed` or `live`.

A runner promise rejection passes through unchanged because it has no Effect `Cause` to preserve.

## `EffectRpcQueryEmptyStreamError`

A live query whose stream completes before it emits a value throws this error. The error exposes the streaming RPC's `rpcTag`. Accumulated streams return an empty array instead.

## `EffectHttpApiQueryConfigError`

Invalid factory or builder configuration throws this error synchronously. Stream execution also rejects incompatible QueryClient hashing. The error's `code` is one of:

- `InvalidMaxChunks`: retention is neither a positive safe integer nor `"unbounded"`.
- `InvalidRefetchMode`: a streamed-query mode is not `reset`, `append`, or `replace`.
- `InvalidMaxEventSize`: an SSE parser limit is not a positive safe integer.
- `InvalidSseOptions`: `sseOptions.dispatchEmptyNamedEvents` is not a boolean.
- `InvalidKeyPrefix`
- `InvalidEndpointPath`
- `EndpointPathCollision`
- `MissingKeyEncoder`
- `UnknownKeyEncoder`
- `UnsupportedEndpointMetadata`
- `UnsupportedQueryHash`: a builder received `queryKeyHashFn` or `queryHash`, or stream execution found either a default hash inconsistent with its key hasher or a conflicting cached identity.

The error exposes `apiId`. When available, it also exposes `groupId`, `endpoint`, `method`, `path`, and an underlying `cause`.

## `EffectHttpApiQueryKeyError`

HTTP query key preparation throws this error synchronously, before client execution. The error exposes `apiId`, `groupId`, `endpoint`, `method`, `cause`, and one of these codes:

- `RequestEncodingFailed`
- `KeyEncoderFailed`
- `InvalidKeyValue`

[HTTP cache identity and failures](/effect-api-query/reference/http-builders/#cache-identity-and-failures) describes each code's trigger.

## `EffectHttpApiQueryError<E>`

This error wraps a failed `Exit` from the HTTP runner. It exposes `apiId`, `groupId`, `endpoint`, `method`, `operation`, and the full `Cause.Cause<E>`. The operation is `query`, `infinite`, `mutation`, `metadata`, `streamed`, or `live`. The guard `isEffectHttpApiQueryError(value)` narrows errors within the same JavaScript realm.

The Cause preserves endpoint, middleware, Schema, and HTTP client errors, including defects and interruption. SSE failures also preserve declared event errors, `Sse.Retry`, and `Sse.SseError`. The Cause can contain upstream requests, responses, or sensitive input values. Those values need inspection before logging or exposure. Runner rejections pass through unchanged.

## `EffectHttpApiQueryEmptyStreamError`

An HTTP live SSE or NDJSON query that completes before it emits a value throws this error. The error exposes `apiId`, `groupId`, `endpoint`, `method`, and operation `live`. A decoded `undefined` emission counts as a value and becomes `null`. A declared header wrapper preserves its body. Accumulated streams complete with an empty or retained history according to their refetch mode.

## `QueryClientOperationError`

The optional Effect cache bridge reports native QueryClient rejections and synchronous cache callback failures through this error. Its `cause` is the exact original value, typed as `unknown`. A generated RPC or HTTP execution error and its complete Cause remain inside that value. A shared in-flight query or arbitrary Promise rejection cannot prove the current options' declared failure payload. Validate a recognized failure before reading domain fields. See [Query Effects](/effect-api-query/guides/query-effects/).

Interrupting one bridge waiter stops that wait. It does not cancel shared cache execution or other observers. Cancel the native query explicitly when the application owns that decision.

## `QueryDescriptorError`

Descriptor capture and rebinding throw this error synchronously:

| Code           | Meaning                                                    |
| -------------- | ---------------------------------------------------------- |
| `Malformed`    | The envelope does not match the descriptor format.         |
| `Incompatible` | The contract identifier, operation prefix or view differs. |
| `Input`        | Input encoding, decoding or preparation failed.            |
| `Identity`     | Input no longer has the same canonical meaning.            |

The descriptor transfers a selection; it transfers no credentials, clients or prepared-input token. See [Loader Descriptors](/effect-api-query/guides/loader-descriptors/).
