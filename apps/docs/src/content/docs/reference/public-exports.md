---
title: Public Exports
description: Package-root values and types.
---

All supported imports come from `effect-api-query`.

| Export                                    | Purpose                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `createRpcQueryUtils`                     | Build the RPC utility tree.                                               |
| `viewPrefix`                              | Select every input of one supported leaf view.                            |
| `withQueryPolicy`                         | Bind typed defaults to an existing query options builder.                 |
| `withMutationPolicy`                      | Bind typed defaults to an existing mutation options builder.              |
| `QueryPolicy`, `MutationPolicy`           | Annotate reusable leaf-specific native policies.                          |
| `InferInput`                              | Derive the operation input from a generated leaf.                         |
| `InferQueryData`, `InferQueryError`       | Derive cached data and failures for a supported query view.               |
| `InferMutationData`, `InferMutationError` | Derive a buffered mutation's result and execution error.                  |
| `fetchStreamSnapshot`                     | Capture stream data and await exact-query cancellation and local cleanup. |
| `StreamSnapshotOptions`                   | Fresh/cached mode, request abort signal, and publication timeout.         |
| `skipToken`                               | Query Core's exact sentinel for disabling queries that require input.     |
| `EffectRpcQueryConfigError`               | Invalid factory or builder configuration.                                 |
| `EffectRpcQueryKeyError`                  | Payload or key preparation failure.                                       |
| `EffectRpcQueryError`                     | Failed RPC `Exit` with its Effect `Cause`.                                |
| `EffectRpcQueryEmptyStreamError`          | Live stream completed without a value.                                    |
| `isEffectRpcQueryError`                   | Runtime guard for RPC execution errors.                                   |
| `CreateRpcQueryUtilsOptions`              | Factory option type.                                                      |
| `RpcQueryUtils`                           | Generated utility-tree type.                                              |
| `RunPromiseExit`                          | Runner adapter type with optional abort signal.                           |
| `KeyEncoder`                              | Synchronous semantic key-encoder type.                                    |
| `JsonValue`                               | Immutable strict-JSON key value.                                          |
| `QueryData`                               | Query success type with possible `undefined` normalized to `null`.        |
| `SkipToken`                               | Type of the exported skip sentinel.                                       |
| `EffectRpcQueryConfigErrorCode`           | Stable configuration error-code union.                                    |
| `EffectRpcQueryKeyErrorCode`              | Stable key error-code union.                                              |

The [HTTP factory](/effect-api-query/reference/http-factory/) adds `createHttpApiQueryUtils`,
`HttpApiQueryUtils`, `CreateHttpApiQueryUtilsOptions`, and `HttpApiKeyEncoder`. Its errors are
`EffectHttpApiQueryError`, `EffectHttpApiQueryEmptyStreamError`, `EffectHttpApiQueryConfigError`, and
`EffectHttpApiQueryKeyError`, with
`isEffectHttpApiQueryError`, `EffectHttpApiQueryConfigErrorCode`, and
`EffectHttpApiQueryKeyErrorCode` for narrowing and stable codes.

`UnaryRpcOptions` describes request-local headers and Context for unary builders.
`StreamingRpcOptions` also accepts the Effect client's stream buffer size.
See [Generated Builders](/effect-api-query/reference/generated-builders/#request-local-rpc-options) for their behavior.

## fetchStreamSnapshot

`fetchStreamSnapshot(queryClient, options, controls?)` returns `Promise<TData>`, preserving native
`select` and its result type. Supply a callable query function, usually through generated
`streamedOptions` or `liveOptions`. Skipped queries and infinite-query options are excluded.

| Control     | Default   | Meaning                                                                                         |
| ----------- | --------- | ----------------------------------------------------------------------------------------------- |
| `mode`      | `'fresh'` | Start an owned attempt; `'cached'` returns an existing successful value without acquiring work. |
| `signal`    | Omitted   | Reject on request abort using `signal.reason`. An already aborted signal acquires no work.      |
| `timeoutMs` | `10_000`  | Wait for publication or completion; a finite positive value at most `2_147_483_647`.            |

Fresh capture requires an idle exact query without observers and starts despite cached freshness
or future timestamps. `cached` preserves native selection, even when another owner is fetching
or observing that successful entry. If no successful entry exists, it uses fresh capture.
QueryClient owns hashing; helper options reject `queryHash` and `queryKeyHashFn`.

| Outcome                                  | Result                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| First new publication                    | Return selected data after cancelling and finalizing the exact query.                   |
| Successful completion                    | Return the completed selected data.                                                     |
| Empty accumulated stream                 | Return the native empty history, subject to its refetch policy.                         |
| Empty live stream                        | Reject with the adapter's empty-stream error.                                           |
| Terminal query failure                   | Reject with the original failure after native retry policy and local cleanup.           |
| Timeout                                  | Reject with a `DOMException` named `TimeoutError` after cancellation and local cleanup. |
| Request abort                            | Reject with the abort reason after cancellation and local cleanup.                      |
| External cancellation before publication | Reject with Query Core's `CancelledError` after local cleanup.                          |

All outcomes detach listeners and the timer. Local cleanup must cooperate with cancellation and
finish before the Promise settles; the timeout does not bound finalizers or acknowledge remote
server cleanup. Keep the exact key exclusively owned throughout capture, including manual writes.
See [Stream Snapshots](/effect-api-query/guides/stream-snapshots/) for request disposal and independent
browser reconnection.

## Type inference

Use [Type Inference](/effect-api-query/reference/type-inference/) for accepted inputs, supported
query views, cached data before `select`, mutation results, and failure types.

## Select a view prefix

`viewPrefix(leaf, view)` returns an immutable ordinary key for every input and stream policy of a
supported leaf view. Pass it to native query filters or `setQueryDefaults`. It carries no DataTag;
broad cache reads remain `unknown`. Use a concrete generated key for typed exact cache access.
See [Cache Filters](/effect-api-query/guides/cache-filters/) for encoded partial input.

## Reuse typed policies

`withQueryPolicy(leaf, view, defaults)` and `withMutationPolicy(leaf, defaults)` return the leaf's
original options builder with shared policy fields applied first. Call-site fields replace matching
defaults, including callbacks. `QueryPolicy<Leaf, View>` and `MutationPolicy<Leaf>` annotate reusable
objects. Inputs, projections, initial data, pagination setup, and adapter controls remain local.
Shared mutation callbacks have an unknown optimistic result; supply `onMutate` and callbacks that
use its result at the call site. See [Defaults and Policies](/effect-api-query/guides/query-defaults/).
