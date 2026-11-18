---
title: Handle Failures
description: Inspect RPC and HTTP Causes and distinguish configuration and key errors.
---

When an RPC returns a failed `Exit`, the query rejects with `EffectRpcQueryError`. Read the RPC tag, operation, and original Effect `Cause` from the error.

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

Review the Cause for private messages or transport values before logging it.

If stream consumption and cleanup both fail, the Cause retains both failures.

The error class tells you which stage failed.

- `EffectRpcQueryConfigError` reports invalid configuration during preparation or incompatible hashing during stream execution.
- `EffectRpcQueryKeyError` reports synchronous payload construction, encoding, or JSON key failures.
- `EffectRpcQueryError` wraps the failed RPC execution and its Cause.
- `EffectRpcQueryEmptyStreamError` means a live stream ended before its first value.

A runner that rejects without returning an `Exit` passes its rejection through. See [error codes](/effect-api-query/reference/errors/) for metadata, or [retry queries](/effect-api-query/guides/retry-queries/) to decide which failures to retry.

## Inspect HTTP failures

Identify HTTP execution errors with `isEffectHttpApiQueryError` from `@ueberbrot/effect-api-query`. Read `apiId`, `groupId`, `endpoint`, `method`, and `operation` from the error. Use `Cause.findError` to inspect endpoint, middleware, Schema, or transport failures. Use `Cause.hasDies` and `Cause.hasInterrupts` for defects and interruption. A Cause can include several reasons.

The wrapper adds declaration identifiers. The original Cause can still contain request headers, bodies, URLs, responses, or Schema issue values. Review it before logging or exposing it.

`EffectHttpApiQueryConfigError` reports configuration failures during preparation or stream execution. `EffectHttpApiQueryKeyError` reports synchronous key preparation failures before the request runs.

The HTTP client encodes mutation input when the mutation runs. Its encoding failures become `EffectHttpApiQueryError`. Runner rejections and callback failures without a failed Exit pass through.

See the [HTTP factory reference](/effect-api-query/reference/http-builders/#cache-identity-and-failures) for key-error codes.

## Match a tagged typed failure

Use `findDeclaredError` to find a single tagged failure. It returns an Effect `Option` typed to the selected tag.

```ts
import { findDeclaredError } from "@ueberbrot/effect-api-query";
import { Option } from "effect";

const missing = findDeclaredError(error, "Missing");
if (Option.isSome(missing)) {
  console.log(missing.value.id);
}
```

The wrapper's failure union includes `{ _tag: 'Missing', id: number }` here. The helper accepts only tags in that union, including typed transport failures. It returns `Some` for a single match and `None` for other errors or a composite Cause. Keep the wrapper if you need the complete Cause. Validate untrusted input separately.
