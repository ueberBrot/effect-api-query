---
title: Public Exports
description: Package-root values and types.
---

The package root, `@ueberbrot/effect-api-query`, exports all supported values and types.

| Export | Purpose |
| --- | --- |
| `createRpcQueryUtils` | Builds the RPC utility tree. |
| `viewPrefix` | Selects every input of one supported leaf view. |
| `createQueryFilter` | Binds a supported view and an explicit partial-input projection to native filters. |
| `QueryFilterEncoder`, `QueryFilterOptions` | Types partial projections and native filter conditions. |
| `withQueryPolicy` | Binds typed defaults to an existing query options builder. |
| `withMutationPolicy` | Binds typed defaults to an existing mutation options builder. |
| `MutationPolicyOptions` | Selects callback replacement or shared-before-local composition. |
| `withQueryInterceptor`, `withMutationInterceptor` | Wrap generated execution while preserving builder inference. |
| `QueryInterceptor`, `MutationInterceptor` | Type native execution context, input, and continuation. |
| `queryViewCodec`, `infiniteQueryCodec` | Bind paired Schema codecs to a leaf view or infinite pages and page parameters. |
| `createHydrationRegistry`, `hydrationCallbacks` | Prepare heterogeneous snapshots or one view with native serialization callbacks. |
| `HydrationCodec`, `HydrationRegistry`, `HydrationCodecError` | Type codec registration, snapshot preparation, and registration failures. |
| `recoverStream` | Reconnect a decoded stream with application-supplied cursor and recovery policy. |
| `RecoverStreamOptions`, `StreamConnectionState` | Type recovery hooks and local connection states. |
| `QueryPolicy`, `MutationPolicy` | Types for reusable native policies specific to a leaf. |
| `InferInput` | Derives operation input from a generated leaf. |
| `InferQueryData`, `InferQueryError` | Derive cached data and failures for a supported query view. |
| `InferMutationData`, `InferMutationError` | Derive a buffered mutation's result and execution error. |
| `fetchStreamSnapshot` | Captures stream data and waits for exact-query cancellation and local cleanup. |
| `StreamSnapshotOptions` | Fresh or cached mode, request abort signal, and publication timeout. |
| `skipToken` | Query Core's exact sentinel for disabling queries that require input. |
| `EffectRpcQueryConfigError` | Invalid factory or builder configuration. |
| `EffectRpcQueryKeyError` | Payload or key preparation failure. |
| `EffectRpcQueryError` | Failed RPC `Exit` with its Effect `Cause`. |
| `EffectRpcQueryEmptyStreamError` | Live stream completed without a value. |
| `isEffectRpcQueryError` | Runtime guard for RPC execution errors. |
| `CreateRpcQueryUtilsOptions` | Factory option type. |
| `RpcQueryUtils` | Generated utility-tree type. |
| `RunPromiseExit` | Runner adapter type with optional abort signal. |
| `KeyEncoder` | Synchronous semantic key-encoder type. |
| `JsonValue` | Immutable strict-JSON key value. |
| `QueryData` | Query success type with possible `undefined` normalized to `null`. |
| `SkipToken` | Type of the exported skip sentinel. |
| `EffectRpcQueryConfigErrorCode` | Stable configuration error-code union. |
| `EffectRpcQueryKeyErrorCode` | Stable key error-code union. |

The [HTTP factory](/effect-api-query/reference/http-factory/) exports `createHttpApiQueryUtils`, `HttpApiQueryUtils`, `CreateHttpApiQueryUtilsOptions`, and `HttpApiKeyEncoder`. Its error classes are `EffectHttpApiQueryError`, `EffectHttpApiQueryEmptyStreamError`, `EffectHttpApiQueryConfigError`, and `EffectHttpApiQueryKeyError`, with `isEffectHttpApiQueryError`, `EffectHttpApiQueryConfigErrorCode`, and `EffectHttpApiQueryKeyErrorCode` for narrowing and stable codes.

`UnaryRpcOptions` describes headers and Context local to a request for unary builders. `StreamingRpcOptions` also accepts the Effect client's stream buffer size. [Generated Builders](/effect-api-query/reference/generated-builders/#request-local-rpc-options) defines their behavior.

## fetchStreamSnapshot

`fetchStreamSnapshot(queryClient, options, controls?)` returns `Promise<TData>` and preserves native `select` and its result type. It requires a callable query function, usually from generated `streamedOptions` or `liveOptions`. It excludes skipped queries and infinite-query options.

| Control | Default | Meaning |
| --- | --- | --- |
| `mode` | `'fresh'` | Starts an owned attempt. `'cached'` returns an existing successful value without acquiring work. |
| `signal` | Omitted | Rejects on request abort using `signal.reason`. An already aborted signal acquires no work. |
| `timeoutMs` | `10_000` | Limits the wait for publication or completion to a finite positive value at most `2_147_483_647`. |

Fresh capture requires an idle exact query without observers. It starts even if cached data is fresh or has a future timestamp. The `cached` mode preserves native selection, even when another owner fetches or observes the successful entry. If no successful entry exists, it uses fresh capture. QueryClient owns hashing. Helper options reject `queryHash` and `queryKeyHashFn`.

| Outcome | Result |
| --- | --- |
| First new publication | Returns selected data after cancelling and finalizing the exact query. |
| Successful completion | Returns the completed selected data. |
| Empty accumulated stream | Returns the native empty history, subject to its refetch policy. |
| Empty live stream | Rejects with the adapter's empty-stream error. |
| Terminal query failure | Rejects with the original failure after native retry policy and local cleanup. |
| Timeout | Rejects with a `DOMException` named `TimeoutError` after cancellation and local cleanup. |
| Request abort | Rejects with the abort reason after cancellation and local cleanup. |
| External cancellation before publication | Rejects with Query Core's `CancelledError` after local cleanup. |

Every outcome detaches listeners and the timer. Local cleanup must cooperate with cancellation and finish before the Promise settles. The timeout does not bound finalizers or acknowledge remote server cleanup. Capture requires exclusive ownership of the exact key, including manual writes. [Stream Snapshots](/effect-api-query/guides/stream-snapshots/) describes request disposal and independent browser reconnection.

## Type inference

[Type Inference](/effect-api-query/reference/type-inference/) describes accepted inputs, supported query views, cached data before `select`, mutation results, and failure types.

## Select a view prefix

`viewPrefix(leaf, view)` returns an immutable ordinary key for every input and stream policy of a supported leaf view. Native query filters and `setQueryDefaults` accept that key. It carries no DataTag, so broad cache reads remain `unknown`. Concrete generated keys provide typed exact cache access. [Cache Filters](/effect-api-query/guides/cache-filters/) describes encoded partial input.

## Reuse typed policies

`withQueryPolicy(leaf, view, defaults)` and `withMutationPolicy(leaf, defaults)` return the leaf's original options builder with shared policy fields applied first. Call-site fields replace matching defaults, including callbacks. `QueryPolicy<Leaf, View>` and `MutationPolicy<Leaf>` annotate reusable objects. Inputs, projections, initial data, pagination setup, and adapter controls remain local. Shared mutation callbacks have an unknown optimistic result. The call site supplies `onMutate` and callbacks that use its result. See [Defaults and Policies](/effect-api-query/guides/query-defaults/).

See [Cache Keys and Filters](/effect-api-query/guides/cache-filters/) for partial projections, [Defaults and Policies](/effect-api-query/guides/query-defaults/) for composition and interception, and [Hydrate Query Views](/effect-api-query/guides/hydrate-query-views/) for codec registration.
