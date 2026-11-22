---
title: Errors
description: Configuration, key-generation, and execution errors for RPC and HTTP.
---

## `EffectRpcQueryConfigError`

Factory or builder configuration failures throw synchronously. Incompatible hashing can also fail during stream execution. Read `code` to locate the problem.

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

An RPC key preparation failure throws before execution. The error exposes `rpcTag`, `cause`, and a code.

- `PayloadConstructionFailed`
- `PayloadEncodingFailed`
- `KeyEncoderFailed`
- `InvalidKeyValue`

## `EffectRpcQueryError<E>`

This error wraps a failed RPC `Exit`. It exposes `rpcTag`, `operation`, and the complete `Cause.Cause<E>`. Use `isEffectRpcQueryError(value)` in the same JavaScript realm. For unary RPCs, `operation` is `call`, `query`, `infinite`, or `mutation`.

Streaming failures use `streamed` or `live` and retain the complete Cause, including cleanup failures.

If the runner rejects without returning an Exit, its rejection passes through.

## `EffectRpcQueryEmptyStreamError`

This error means a live stream ended before its first value. It exposes `rpcTag`. A new unseeded accumulated query can succeed with `[]`.

## `EffectHttpApiQueryConfigError`

HTTP factory and builder failures throw synchronously. Incompatible hashing can also fail during stream execution. Read `code` to locate the problem.

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

This error throws during key preparation, before the client runs. It exposes `apiId`, `groupId`, `endpoint`, `method`, `cause`, and a code.

- `RequestEncodingFailed`
- `KeyEncoderFailed`
- `InvalidKeyValue`

[HTTP cache identity and failures](/effect-api-query/reference/http-builders/#cache-identity-and-failures) describes each code's trigger.

## `EffectHttpApiQueryError<E>`

This error wraps a failed HTTP `Exit`. It exposes `apiId`, `groupId`, `endpoint`, `method`, `operation`, and `Cause.Cause<E>`. Operations are `call`, `query`, `infinite`, `mutation`, `metadata`, `streamed`, and `live`. Use `isEffectHttpApiQueryError(value)` in the same JavaScript realm.

The Cause retains endpoint, middleware, Schema, and transport failures, including defects and interruption. SSE can also report declared event errors, `Sse.Retry`, and `Sse.SseError`. Inspect the Cause for private values before logging it. Runner rejections without an Exit pass through.

## `EffectHttpApiQueryEmptyStreamError`

This error means a live HTTP stream ended before its first value. It exposes the API, group, endpoint, method, and operation `live`. A decoded `undefined` counts as an emission and becomes `null`. A header wrapper keeps its body. Empty accumulated streams follow their refetch policy.

## `QueryClientOperationError`

The Effect cache bridge wraps native rejections and synchronous callback failures in this class. Its `cause: unknown` contains the original value, including any adapter error and full Effect Cause. Shared query work can come from a different caller. Validate a recognized failure before reading its fields. See [query effects](/effect-api-query/guides/query-effects/).

Interrupt an Effect waiter to stop its wait. To stop shared work, cancel the native query explicitly.

## `QueryDescriptorError`

Capture or rebinding throws this error before execution.

| Code           | Meaning                                                    |
| -------------- | ---------------------------------------------------------- |
| `Malformed`    | The envelope does not match the descriptor format.         |
| `Incompatible` | The contract identifier, operation prefix or view differs. |
| `Input`        | Input encoding, decoding or preparation failed.            |
| `Identity`     | Input no longer has the same canonical meaning.            |

See [loader descriptors](/effect-api-query/guides/loader-descriptors/) for capture, rebinding, and failure handling.
