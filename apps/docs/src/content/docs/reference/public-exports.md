---
title: Public Exports
description: Package-root values and types.
---

All supported imports come from `effect-api-query`.

| Export                           | Purpose                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `createRpcQueryUtils`            | Build the RPC utility tree.                                        |
| `skipToken`                      | Query Core’s exact sentinel for disabling payload-bearing queries. |
| `EffectRpcQueryConfigError`      | Invalid factory or builder configuration.                          |
| `EffectRpcQueryKeyError`         | Payload or key preparation failure.                                |
| `EffectRpcQueryError`            | Failed RPC `Exit` with its Effect `Cause`.                         |
| `EffectRpcQueryEmptyStreamError` | Live stream completed without a value.                             |
| `isEffectRpcQueryError`          | Runtime guard for RPC execution errors.                            |
| `CreateRpcQueryUtilsOptions`     | Factory option type.                                               |
| `RpcQueryUtils`                  | Generated utility-tree type.                                       |
| `RunPromiseExit`                 | Runner adapter type with optional abort signal.                    |
| `KeyEncoder`                     | Synchronous semantic key-encoder type.                             |
| `JsonValue`                      | Immutable strict-JSON key value.                                   |
| `QueryData`                      | Query success type with possible `undefined` normalized to `null`. |
| `SkipToken`                      | Type of the exported skip sentinel.                                |
| `EffectRpcQueryConfigErrorCode`  | Stable configuration error-code union.                             |
| `EffectRpcQueryKeyErrorCode`     | Stable key error-code union.                                       |

The [HTTP factory](/effect-api-query/reference/http-factory/) adds `createHttpApiQueryUtils`,
`HttpApiQueryUtils`, `CreateHttpApiQueryUtilsOptions`, and `HttpApiKeyEncoder`. Its errors are
`EffectHttpApiQueryError`, `EffectHttpApiQueryConfigError`, and `EffectHttpApiQueryKeyError`, with
`isEffectHttpApiQueryError`, `EffectHttpApiQueryConfigErrorCode`, and
`EffectHttpApiQueryKeyErrorCode` for narrowing and stable codes.

`UnaryRpcOptions` describes request-local headers and Context for unary builders.
`StreamingRpcOptions` additionally accepts the Effect client's stream buffer size.
See [Generated Builders](/effect-api-query/reference/generated-builders/#request-local-rpc-options) for their behavior.
