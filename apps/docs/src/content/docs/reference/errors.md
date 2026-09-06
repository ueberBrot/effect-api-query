---
title: Errors
description: Configuration, key-generation, and execution errors for RPC and HTTP.
---

## `EffectRpcQueryConfigError`

Thrown synchronously while configuring the utility tree or an option builder. Its `code` is one of:

- `InvalidMaxChunks`: a streamed-query bound is not a positive safe integer.
- `InvalidKeyPrefix`
- `InvalidRpcPath`
- `RpcPathCollision`
- `MissingKeyEncoder`
- `UnknownKeyEncoder`

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

- `InvalidKeyPrefix`
- `InvalidEndpointPath`
- `EndpointPathCollision`
- `MissingKeyEncoder`
- `UnknownKeyEncoder`
- `UnsupportedEndpointMetadata`

It exposes `apiId` and, when available, `groupId`, `endpoint`, `method`, `path`, and an underlying
`cause`.

## `EffectHttpApiQueryKeyError`

Thrown synchronously while preparing an HTTP query key, before client execution. It exposes
`apiId`, `groupId`, `endpoint`, `method`, `cause`, and one of these codes:

- `RequestEncodingFailed`
- `KeyEncoderFailed`
- `InvalidKeyValue`

See [HTTP cache identity and failures](/effect-rpc-query/reference/http-factory/#cache-identity-and-failures)
for the trigger for each code.

## `EffectHttpApiQueryError<E>`

Thrown when the HTTP runner returns a failed `Exit`. It exposes `apiId`, `groupId`, `endpoint`,
`method`, `operation`, and the full `Cause.Cause<E>`. The operation is `query` or `mutation`.
Use `isEffectHttpApiQueryError(value)` to narrow errors within the same JavaScript realm.

The Cause preserves endpoint, middleware, Schema, and HTTP client errors, including defects and
interruption. It can contain upstream requests, responses, or sensitive input values; inspect those
values before logging or exposing them. Runner rejections pass through unchanged.
