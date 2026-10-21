# effect-api-query

## 0.2.0

### Minor Changes

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Add `createQueryFilter` for native TanStack query filters scoped to a generated leaf and view. Typed explicit projections support partial canonical input matching without applying constructor defaults or assuming custom encoders are invertible.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Add opt-in shared-before-local mutation callback composition and typed query and mutation execution interceptors. Preserve existing callback replacement by default, builder inference, native retries, cancellation, keys, and disabled queries.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Add opt-in `publicationBatchSize` for accumulated RPC and HTTP SSE queries. Publish the first element immediately, preserve event order, and flush partial batches on completion or failure. Include nondefault publication policy in cache identity while retaining existing defaults and cancellation behavior.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Add optional typed leaf/view hydration codecs, explicit infinite page-parameter codecs, service-free native callbacks, and an effectful registry that prepares complete native query batches before hydration.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Add `recoverStream` for application-owned decoded Effect streams with ordered numeric cursors, duplicate suppression, cancellable retry delays, replay-expiry and gap refresh hooks, and observable connection-state callbacks. Preserve the original terminal Cause and keep resume cursors separate from logical query identity.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Update runtime dependencies, including Effect and TanStack Query.

### Patch Changes

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Preserve fetched HTTP metadata structural sharing and frozen envelopes when observer options are rebuilt during an in-flight request, including replacement utility trees.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Index stream hash-conflict checks by QueryCache and hash function. Reuse the index across executions and reconcile Query identity and insertion order through nested cache notifications, preserving collision guards when subscribers recreate removed entries. Release the subscription when the cache empties and rebuild it on the next execution. Native TanStack Query lookup behavior remains unchanged.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Reuse schema key encoders, RPC input analysis, and HTTP endpoint descriptions for immutable Effect declarations, including those requiring custom encoders. Failed suspended-schema inspection remains retryable. Each eager utility tree still binds its own ready client, runner, prefix, and custom encoders; payload values and mutable option objects are never memoized.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Clarify that native cancellation can start a replacement stream before the old iterator's asynchronous finalizer completes. Document application coordination for streams that require exclusive resources.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Correct HTTP utility types for empty success declarations to expose buffered builders with null query data and void mutation results.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Preserve complete stream finalizer Causes in RPC and HTTP execution errors, including finite completion and snapshot cleanup failures.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Preserve interruption and cleanup defects in RPC and HTTP execution errors when cancellation interrupts a pending stream pull.

- [#140](https://github.com/ueberBrot/effect-api-query/pull/140) [`916478e`](https://github.com/ueberBrot/effect-api-query/commit/916478e6f0dc80b3f6bcfd3ab21a76f590feb87f) - Preserve complete source and cleanup Causes in stream recovery retry decisions and terminal failures.

## 0.1.0

### Minor Changes

- Initial release with typed queries, mutations, and paginated queries from Effect RPC and HTTP API contracts.

- Support accumulated and live streams, HTTP response metadata, and multipart uploads.

- Share query policies and cache filters, and capture stream snapshots for server rendering.
