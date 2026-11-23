# Add direct leaf execution and shared error handling

Status: Accepted. Partially amends [ADR 0002](0002-let-call-sites-choose-query-or-mutation.md) and extends [ADR 0005](0005-preserve-the-cause-in-one-error-wrapper.md).

## Context

Applications sometimes need to call a ready client outside a TanStack Query view. Error handling for RPC and HTTP follows the same rules for typed failures, defects, and interruption.

## Decision

Expose `call` and `effect` on unary RPC and buffered HTTP leaves, including buffered multipart endpoints. Streaming leaves expose their stream views. Both methods accept the client's input and transport options. A queryable leaf also accepts its own prepared input. Direct execution generates no cache key and applies no Query view policies.

`call` runs through the leaf runtime, including any query-owner runner. It accepts an abort signal and preserves the successful value, including `undefined`. A failed Exit uses the existing adapter wrapper with operation `"call"`. HTTP uses decoded-only response mode.

`effect` returns the ready client's Effect, leaving execution, errors, and service provision to the caller.

Use `isEffectApiQueryError` and `getExecutionCause` across both wrappers. `findDeclaredError` and `matchDeclaredError` classify a Cause with exactly one tagged failure. `retryExecutionError` delegates a Cause with one typed failure to the app's retry decision, up to three retries by default.

Reserve `call`, `effect`, and `queryFilter` as utility path segments.

## Consequences

Call sites choose between direct execution and the native Query views. Existing execution wrappers keep the full Cause, so apps can inspect defects, interruption, and multiple failures.
