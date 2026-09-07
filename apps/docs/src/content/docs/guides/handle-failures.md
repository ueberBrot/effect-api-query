---
title: Handle Failures
description: Inspect RPC and HTTP Causes and distinguish configuration and key errors.
---

A failed RPC `Exit` becomes `EffectRpcQueryError`. The error records the RPC tag, the generated
operation that ran, and the complete Effect `Cause`:

```ts
import { Cause } from 'effect'
import { isEffectRpcQueryError } from 'effect-api-query'

const logRpcError = (error: unknown) => {
  if (isEffectRpcQueryError(error)) {
    console.error(error.rpcTag, error.operation)
    console.error(Cause.pretty(error.cause))
  }
}
```

These error classes distinguish failure stages:

- `EffectRpcQueryConfigError` reports invalid factory or builder configuration synchronously.
- `EffectRpcQueryKeyError` reports synchronous payload construction, encoding, or JSON
  canonicalization failures.
- `EffectRpcQueryError` reports a failed RPC execution and preserves its Effect `Cause`.
- `EffectRpcQueryEmptyStreamError` reports a live stream that completed before emitting a value.

If a custom runner rejects instead of returning an `Exit`, its rejection passes through unchanged.
See the [error reference](/effect-api-query/reference/errors/) for stable codes and metadata.

## Inspect HTTP failures

Import `isEffectHttpApiQueryError` from `effect-api-query` to recognize a failed HTTP execution.
The wrapper identifies `apiId`, `groupId`, `endpoint`, `method`, and `operation`. Its `cause` is the
original complete Effect Cause: use `Cause.findError` to inspect declared endpoint errors,
middleware errors, Schema errors, and HTTP client errors; use `Cause.hasDies` and
`Cause.hasInterrupts` to distinguish defects and interruption. A Cause may contain several reasons.

The package adds only declaration identity to execution-error metadata. The preserved Cause can
itself contain upstream request headers, bodies, concrete URLs, responses, or Schema issue values.
Review those values before logging or exposing them. The package does not sanitize the Cause.

`EffectHttpApiQueryConfigError` reports invalid factory configuration synchronously.
`EffectHttpApiQueryKeyError` reports synchronous query-key preparation failures, before HTTP
execution. Mutations encode their request inside the ready client's Effect, so encoding failures
become `EffectHttpApiQueryError` instead. Runner rejections and user or TanStack callback failures
pass through unchanged when they produce no failed Exit.

See the [HTTP factory reference](/effect-api-query/reference/http-factory/#cache-identity-and-failures)
for key-error codes.

The [packed RPC consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/packed-consumer/runtime.mts) and
[packed HTTP consumer](https://github.com/ueberBrot/effect-api-query/blob/main/tests/packed-consumer/http-runtime.mts) verify error guards and preserved Causes.
