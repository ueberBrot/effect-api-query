---
title: Errors
description: Configuration, key-generation, and execution errors for RPC and HTTP.
---

## `EffectRpcQueryConfigError`

Invalid factory or builder configuration throws this error synchronously. Stream execution also
rejects incompatible QueryClient hashing. The error's `code` is one of:

- `InvalidMaxChunks`: a streamed-query bound is not a positive safe integer.
- `InvalidRefetchMode`: a streamed-query mode is not `reset`, `append`, or `replace`.
- `InvalidKeyPrefix`
- `InvalidRpcPath`
- `RpcPathCollision`
- `MissingKeyEncoder`
- `UnknownKeyEncoder`
- `UnsupportedQueryHash`: a builder received `queryKeyHashFn` or `queryHash`, or stream execution
  found either a default hash inconsistent with its key hasher or a conflicting cached identity.

The error can also expose `rpcTag`, `path`, and an underlying `cause`.

## `EffectRpcQueryKeyError`

Payload-specific key preparation throws this error synchronously. The error exposes `rpcTag`,
`cause`, and one of these codes:

- `PayloadConstructionFailed`
- `PayloadEncodingFailed`
- `KeyEncoderFailed`
- `InvalidKeyValue`

## `EffectRpcQueryError<E>`

This error wraps a failed `Exit` from the RPC runner. It exposes `rpcTag`, `operation`, and the
full `Cause.Cause<E>`. The runtime guard `isEffectRpcQueryError(value)` uses `instanceof` within
one JavaScript realm. The operation is `query`, `infinite`, or `mutation`.

Streaming failures use the same class. They preserve RPC, stream, middleware, client, defect, and
interruption Causes, with operation `streamed` or `live`.

A runner promise rejection passes through unchanged because it has no Effect `Cause` to preserve.

## `EffectRpcQueryEmptyStreamError`

A live query whose stream completes before it emits a value throws this error.
The error exposes the streaming RPC's `rpcTag`. Accumulated streams return an empty array instead.

## `EffectHttpApiQueryConfigError`

Invalid factory or builder configuration throws this error synchronously. Stream execution also
rejects incompatible QueryClient hashing. The error's `code` is one of:

- `InvalidMaxChunks`: a streamed-query bound is not a positive safe integer.
- `InvalidRefetchMode`: a streamed-query mode is not `reset`, `append`, or `replace`.
- `InvalidMaxEventSize`: an SSE parser limit is not a positive safe integer.
- `InvalidKeyPrefix`
- `InvalidEndpointPath`
- `EndpointPathCollision`
- `MissingKeyEncoder`
- `UnknownKeyEncoder`
- `UnsupportedEndpointMetadata`
- `UnsupportedQueryHash`: a builder received `queryKeyHashFn` or `queryHash`, or stream execution
  found either a default hash inconsistent with its key hasher or a conflicting cached identity.

The error exposes `apiId`. When available, it also exposes `groupId`, `endpoint`, `method`, `path`,
and an underlying `cause`.

## `EffectHttpApiQueryKeyError`

HTTP query key preparation throws this error synchronously, before client execution.
The error exposes `apiId`, `groupId`, `endpoint`, `method`, `cause`, and one of these codes:

- `RequestEncodingFailed`
- `KeyEncoderFailed`
- `InvalidKeyValue`

[HTTP cache identity and failures](/effect-api-query/reference/http-builders/#cache-identity-and-failures)
describes each code's trigger.

## `EffectHttpApiQueryError<E>`

This error wraps a failed `Exit` from the HTTP runner. It exposes `apiId`, `groupId`, `endpoint`,
`method`, `operation`, and the full `Cause.Cause<E>`. The operation is `query`, `infinite`, `mutation`,
`metadata`, `streamed`, or `live`.
The guard `isEffectHttpApiQueryError(value)` narrows errors within the same JavaScript realm.

The Cause preserves endpoint, middleware, Schema, and HTTP client errors, including defects and
interruption. SSE failures also preserve declared event errors, `Sse.Retry`, and `Sse.SseError`.
The Cause can contain upstream requests, responses, or sensitive input values.
Those values need inspection before logging or exposure. Runner rejections pass through unchanged.

## `EffectHttpApiQueryEmptyStreamError`

An HTTP live SSE query that completes before it emits a value throws this error.
The error exposes `apiId`, `groupId`, `endpoint`, `method`, and operation `live`.
A decoded `undefined` emission counts as a value and becomes `null`.
A declared header wrapper preserves its body. Accumulated streams complete with an empty or
retained history according to their refetch mode.
