---
title: Public Exports
description: Package-root values and types.
---

Import these values and types from `@ueberbrot/effect-api-query`.

| Export | Purpose |
| --- | --- |
| `queryEffects`, `QueryClientService` | Compose native cache operations in Effect with the existing application QueryClient. |
| `QueryClientOperationError` | Retains exact native rejections, including execution wrappers, as an unknown cause. |
| `acquireQueryOwner`, `QueryOwner`, `QueryOwnerSetup` | Opt in to acquired/borrowed resource setup, guarded cache callbacks and local query/mutation retirement. |
| `configureUtils` | Configure policies and ordered interceptors on a tree, branch, or leaf. |
| `defineRpcPolicy`, `defineHttpApiPolicy` | Check reusable policy maps against contracts before acquiring clients. |
| `UtilsConfiguration`, `ConfiguredUtils` | Type configuration and the configured utility tree. |
| `prepareInput`, `PreparedInput` | Reuse owner-bound input preparation explicitly. |
| `isEffectApiQueryError`, `getExecutionCause` | Recognize either execution wrapper and read its original Cause. |
| `findDeclaredError`, `matchDeclaredError` | Select or handle one tagged failure in an execution error. |
| `retryExecutionError`, `RetryExecutionErrorOptions` | Build a bounded Query retry predicate for single typed failures. |
| `runQueryEvents` | Run sequential event handlers and recovery against a retiring query owner’s native cache. |
| `consumeEvents`, `ConsumeEventsOptions` | Consume events sequentially with start and exit callbacks. |
| `createRpcQueryUtils` | Builds the RPC utility tree. |
| `viewPrefix` | Selects every input of one supported leaf view. |
| `createQueryFilter` | Binds a supported view and an explicit partial-input projection to native filters. |
| `QueryFilterEncoder`, `QueryFilterOptions` | Types partial projections and native filter conditions. |
| `MutationPolicyOptions` | Selects callback replacement or shared-before-local composition. |
| `QueryInterceptor`, `MutationInterceptor` | Type native execution context, input, and continuation. |
| `queryViewCodec`, `infiniteQueryCodec` | Bind paired Schema codecs to a leaf view or infinite pages and page parameters. |
| `createHydrationRegistry`, `hydrationCallbacks` | Prepare heterogeneous snapshots or one view with native serialization callbacks. |
| `HydrationCodec`, `HydrationRegistry`, `HydrationCodecError` | Type codec registration, snapshot preparation, and registration failures. |
| `recoverStream` | Reconnect a decoded stream with application-supplied cursor and recovery policy. |
| `RecoverStreamOptions`, `StreamConnectionState`, `StreamCursorPolicy` | Type recovery hooks and local connection states. |
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

See the [HTTP factory](/effect-api-query/reference/http-factory/) for HTTP types and [errors](/effect-api-query/reference/errors/) for error classes and codes.

Use `UnaryRpcOptions` for local headers and Context. `StreamingRpcOptions` adds the client's stream buffer size. See [request-local RPC options](/effect-api-query/reference/generated-builders/#request-local-rpc-options).

## fetchStreamSnapshot

`fetchStreamSnapshot(queryClient, options, controls?)` returns `Promise<TData>` and applies native `select`. Pass options with a callable query function, usually from `streamedOptions` or `liveOptions`. Skipped and infinite options are not accepted.

| Control | Default | Meaning |
| --- | --- | --- |
| `mode` | `'fresh'` | Starts an owned attempt. `'cached'` returns an existing successful value without acquiring work. |
| `signal` | Omitted | Rejects on request abort using `signal.reason`. An already aborted signal acquires no work. |
| `timeoutMs` | `10_000` | Limits the wait for publication or completion to a finite positive value at most `2_147_483_647`. |

Reserve an idle, unobserved exact key for fresh capture. A fresh capture starts despite a fresh cache entry. Use `cached` to select from existing successful data even if another observer is present. If there is none, the helper starts a fresh capture. Set hashing in QueryClient defaults.

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

On settlement the helper removes its listeners and timer. Avoid other writes to the key during capture. The timeout bounds the wait for data. Local finalizers must still finish. Use an application acknowledgement for remote cleanup. See [stream snapshots](/effect-api-query/guides/stream-snapshots/).

## Type inference

See [type inference](/effect-api-query/reference/type-inference/) for input, cached data before `select`, mutation results, and errors.

## Select a view prefix

`viewPrefix(leaf, view)` returns a frozen key prefix for every input and stream policy of one view. Use it with filters or `setQueryDefaults`. It has no data tag, so broad reads infer `unknown`. Use a concrete generated key for typed exact access. See [cache filters](/effect-api-query/guides/cache-filters/).

## Configure shared behavior

`configureUtils(treeOrLeaf, configuration)` returns frozen utilities and keeps their keys. Set TanStack options and `interceptors` inside each view. Mutations also take `callbacks: "replace" | "compose"`. Use `paths` for named descendants.

Policy precedence runs from QueryClient defaults to tree, branch, leaf, and call site. Interceptors wrap broad to specific, with the first entry outermost. Leaf callbacks infer contract types. Shared callbacks receive `unknown`.

Use `QueryPolicy<Leaf, View>` or `MutationPolicy<Leaf>` for reusable settings. Keep input, selection, initial data, page mapping, and optimistic context local. A `streamed` retention setting applies to both keys and options.

See [defaults and policies](/effect-api-query/guides/query-defaults/) for callback composition and examples.

## QueryClient operations in Effect

See [query effects](/effect-api-query/guides/query-effects/) to read, update, or invalidate the native cache from Effect and handle interruption.

## Loader selections

Use `createQueryDescriptor` to register one leaf and view for transfer. `QueryDescriptor` describes the selection. `QueryDescriptorError` reports malformed, incompatible, input, and identity failures before execution. See [loader selections](/effect-api-query/guides/loader-descriptors/).
