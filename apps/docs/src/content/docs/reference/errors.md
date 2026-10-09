---
title: Errors
description: Configuration, key-generation, and execution errors for RPC and HTTP.
---

## `EffectRpcQueryConfigError`

Thrown synchronously while configuring the utility tree or an option builder. Its `code` is one of:

- `InvalidMaxChunks`: a streamed-query bound is not a positive safe integer.
- `InvalidRefetchMode`: a streamed-query mode is not `reset`, `append`, or `replace`.
- `InvalidKeyPrefix`
- `InvalidRpcPath`
- `RpcPathCollision`
- `MissingKeyEncoder`
- `UnknownKeyEncoder`
- `UnsupportedQueryHash`: an option builder received `queryKeyHashFn` or `queryHash`.

It can also expose `rpcTag`, `path`, and an underlying `cause`.

## `EffectRpcQueryKeyError`

Thrown synchronously while preparing a payload-specific key. It exposes `rpcTag`, `cause`, and one
of these codes:

- `PayloadConstructionFailed`
- `PayloadEncodingFailed`
- `KeyEncoderFailed`
- `InvalidKeyValue`

## `EffectRpcQueryError<E>`

Thrown when the RPC runner returns a failed `Exit`. It exposes `rpcTag`, `operation`, and the full
`Cause.Cause<E>`. Use `isEffectRpcQueryError(value)` as the runtime guard within one JavaScript
realm; the guard uses `instanceof`. The operation is `query`, `infinite`, or `mutation`.

Streaming failures use the same class and preserve RPC, stream, middleware, client, defect, and
interruption Causes. Their operation is `streamed` or `live`.

A rejected runner promise passes through unchanged because no Effect `Cause` exists to preserve.

## `EffectRpcQueryEmptyStreamError`

Thrown when a live query's stream completes before emitting a value. It exposes the streaming RPC's
`rpcTag`. Accumulated streams return an empty array instead.

## `EffectHttpApiQueryConfigError`

Thrown synchronously while configuring HTTP utilities. Its `code` is one of:

- `InvalidMaxChunks`: a streamed-query bound is not a positive safe integer.
- `InvalidRefetchMode`: a streamed-query mode is not `reset`, `append`, or `replace`.
- `InvalidMaxEventSize`: an SSE parser limit is not a positive safe integer.
- `InvalidKeyPrefix`
- `InvalidEndpointPath`
- `EndpointPathCollision`
- `MissingKeyEncoder`
- `UnknownKeyEncoder`
- `UnsupportedEndpointMetadata`
- `UnsupportedQueryHash`: an option builder received `queryKeyHashFn` or `queryHash`.

It exposes `apiId` and, when available, `groupId`, `endpoint`, `method`, `path`, and an underlying
`cause`.

## `EffectHttpApiQueryKeyError`

Thrown synchronously while preparing an HTTP query key, before client execution. It exposes
`apiId`, `groupId`, `endpoint`, `method`, `cause`, and one of these codes:

- `RequestEncodingFailed`
- `KeyEncoderFailed`
- `InvalidKeyValue`

See [HTTP cache identity and failures](/effect-api-query/reference/http-factory/#cache-identity-and-failures)
for each code's trigger.

## `EffectHttpApiQueryError<E>`

Thrown when the HTTP runner returns a failed `Exit`. It exposes `apiId`, `groupId`, `endpoint`,
`method`, `operation`, and the full `Cause.Cause<E>`. The operation is `query`, `infinite`, `mutation`,
`streamed`, or `live`.
Use `isEffectHttpApiQueryError(value)` to narrow errors within the same JavaScript realm.

The Cause preserves endpoint, middleware, Schema, and HTTP client errors, including defects and
interruption. SSE failures also preserve declared event errors, `Sse.Retry`, and `Sse.SseError`.
It can contain upstream requests, responses, or sensitive input values; inspect those
values before logging or exposing them. Runner rejections pass through unchanged.

## `EffectHttpApiQueryEmptyStreamError`

Thrown when an HTTP live SSE query completes before emitting a value. It exposes `apiId`,
`groupId`, `endpoint`, `method`, and operation `live`. A decoded `undefined` emission counts as a
value and becomes `null`; a declared header wrapper preserves its body. Accumulated streams
complete with an empty or retained history according to their refetch mode.
