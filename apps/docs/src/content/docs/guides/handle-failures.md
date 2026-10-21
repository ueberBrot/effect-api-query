---
title: Handle Failures
description: Inspect RPC and HTTP Causes and distinguish configuration and key errors.
---

A failed RPC `Exit` becomes `EffectRpcQueryError`. The error records the RPC tag, the generated operation, and the complete Effect `Cause`. Inspect the error in your application handler:

```ts
import { isEffectRpcQueryError } from "@ueberbrot/effect-api-query";
import { Cause } from "effect";

const logRpcError = (error: unknown) => {
  if (isEffectRpcQueryError(error)) {
    console.error(error.rpcTag, error.operation);
    console.error(Cause.pretty(error.cause));
  }
};
```

Review the Cause for private messages and transport values before logging it.

Stream execution errors also preserve failures from local finalizers. If consumption and cleanup both fail, the Cause retains both failures.

Use the error class to identify the failure stage:

- `EffectRpcQueryConfigError` reports invalid configuration. It occurs synchronously during preparation, or during stream execution when QueryClient hashing is incompatible.
- `EffectRpcQueryKeyError` reports synchronous payload construction, encoding, or JSON canonicalization failures.
- `EffectRpcQueryError` reports a failed RPC execution and preserves its Effect `Cause`.
- `EffectRpcQueryEmptyStreamError` reports a live stream that completed before emitting a value.

If a custom runner rejects instead of returning an `Exit`, its rejection passes through unchanged. See the [error reference](/effect-api-query/reference/errors/) for stable codes and metadata. Use [retry queries](/effect-api-query/guides/retry-queries/) for typed `Cause` and `Result` decisions, bounded attempt counts, and synchronous preparation errors.

## Inspect HTTP failures

Import `isEffectHttpApiQueryError` from `@ueberbrot/effect-api-query` to recognize a failed HTTP execution. The wrapper records `apiId`, `groupId`, `endpoint`, `method`, and `operation`. Its `cause` retains the complete original Effect Cause. Use `Cause.findError` to inspect declared endpoint errors, middleware errors, Schema errors, and HTTP client errors. Use `Cause.hasDies` and `Cause.hasInterrupts` to distinguish defects and interruption. A Cause can contain several reasons.

The package adds only declaration identity to execution-error metadata. The preserved Cause can contain upstream request headers, bodies, concrete URLs, responses, or Schema issue values. Review those values before logging or exposing them. The package does not sanitize the Cause.

`EffectHttpApiQueryConfigError` reports invalid configuration at the same stages as the RPC error: preparation or stream execution. `EffectHttpApiQueryKeyError` reports synchronous failures during query-key preparation, before HTTP execution.

Mutations encode their request inside the ready client's Effect. Their encoding failures therefore become `EffectHttpApiQueryError`. Runner rejections and user or TanStack callback failures pass through unchanged when they produce no failed Exit.

See the [HTTP factory reference](/effect-api-query/reference/http-builders/#cache-identity-and-failures) for key-error codes.
