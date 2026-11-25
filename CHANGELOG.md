# effect-api-query

## 0.9.0

### Minor Changes

- [#262](https://github.com/ueberBrot/effect-api-query/pull/262) [`1182c6e`](https://github.com/ueberBrot/effect-api-query/commit/1182c6ef98905c07c842e6538e842ff6f254901c) - Isolate generated RPC and HTTP cache namespaces with versioned keys. Root and branch filters and native prefix defaults now match the entire caller key prefix, including objects and arrays, while still matching descendants.

  Upgrade the version or buster for persisted TanStack caches and discard snapshots with the old generated keys. Deploy matching versions on both sides of SSR and rebuild any hand-authored keys using the generated builders. Legacy keys can be ambiguous, so they cannot be migrated automatically.

- [#254](https://github.com/ueberBrot/effect-api-query/pull/254) [`6c2e9be`](https://github.com/ueberBrot/effect-api-query/commit/6c2e9be685ab2afd861a4f6f2fc104319bf7acd3) - `createContractHydrationRegistry` omits HTTP `metadata` codecs by default so unfiltered server-only response headers do not enter browser snapshots. Opt into derived metadata hydration with an explicit allowlist (`views: { metadata: { headers: [...] } }` or `paths[path].metadata: { headers: [...] }`) or supply a custom metadata codec.

- [#252](https://github.com/ueberBrot/effect-api-query/pull/252) [`38d7d43`](https://github.com/ueberBrot/effect-api-query/commit/38d7d433661ed701518acda559d9bb1f0031c2cd) - HTTP utility construction requires a custom key encoder when declared headers, query parameters, or URL-encoded non-body payloads match `HttpApi.RedactedNames` at the API, group, or endpoint level. Supply a safe `keyEncoders` entry or move credentials to transport middleware so annotated secrets do not enter canonical keys or dehydrated snapshots.

### Patch Changes

- [#275](https://github.com/ueberBrot/effect-api-query/pull/275) [`8863dd7`](https://github.com/ueberBrot/effect-api-query/commit/8863dd744480d8f806137c48cb49938df24de171) - Screen incoming values and cache plain array and object metadata once per pass in `schemaStructuralSharing`. Reusing container metadata across cycle detection, atom screening, and recursive sharing avoids repeated descriptor and own-key scans.

- [#260](https://github.com/ueberBrot/effect-api-query/pull/260) [`a2357f7`](https://github.com/ueberBrot/effect-api-query/commit/a2357f7399af76bfd0c1a0134e348e63ba707335) - Clear seeded RPC and HTTP accumulated stream data when a reset refetch starts. The query enters pending without cached data, and a failure before the first emission leaves the data cleared.

- [#275](https://github.com/ueberBrot/effect-api-query/pull/275) [`8863dd7`](https://github.com/ueberBrot/effect-api-query/commit/8863dd744480d8f806137c48cb49938df24de171) - Decouple HTTP metadata query preparation from the shared utility tree and mark `QueryClientService` and builder registries as pure. Bundlers now drop unused HTTP metadata and structural-sharing helpers from RPC-only and minimal consumer bundles.

- [#275](https://github.com/ueberBrot/effect-api-query/pull/275) [`8863dd7`](https://github.com/ueberBrot/effect-api-query/commit/8863dd744480d8f806137c48cb49938df24de171) - Poll ready stream pulls and completed deadline gates before awaiting or racing during stream publication, reducing per-chunk overhead in batched and coalesced streams.

- [#254](https://github.com/ueberBrot/effect-api-query/pull/254) [`6c2e9be`](https://github.com/ueberBrot/effect-api-query/commit/6c2e9be685ab2afd861a4f6f2fc104319bf7acd3) - Contract-derived hydration derives `HttpApiSchema.asNoContent` codecs from the decoded schema so cached synthesized values round-trip across `query`, `metadata.data`, and `infinite.pages` without re-invoking the `asNoContent` factory. Plain `NoContent` responses continue to normalize to `null`.

- [#258](https://github.com/ueberBrot/effect-api-query/pull/258) [`033bfdd`](https://github.com/ueberBrot/effect-api-query/commit/033bfddb8e0dcdc595fc7dad24aaf1f93a81f1cd) - Preserve all raw response header names as own properties when HTTP metadata queries refetch with default structural sharing. Freeze interceptor replacement and fallback envelopes and their header snapshots for both imperative fetches and cached results.

- [#252](https://github.com/ueberBrot/effect-api-query/pull/252) [`38d7d43`](https://github.com/ueberBrot/effect-api-query/commit/38d7d433661ed701518acda559d9bb1f0031c2cd) - Canonical HTTP request keys preserve repeated wire-parameter ordering when multiple URL-encoded entries flatten to the same serialized parameter name across query parameters, non-body payloads, or form-urlencoded payloads. Order-independent fixed-struct inputs keep their existing canonical keys.

- [#275](https://github.com/ueberBrot/effect-api-query/pull/275) [`8863dd7`](https://github.com/ueberBrot/effect-api-query/commit/8863dd744480d8f806137c48cb49938df24de171) - Reduce TypeScript instantiations for large RPC and HTTP utility trees. Standard `HttpApiClient.ForApi` clients and untouched groups bypass per-endpoint service and error derivation, prefixed `createRpcQueryUtils` calls match before unprefixed overloads, `ContainsRedacted` exits immediately on primitives, and sparse `configureUtils` retention and hydration helpers prune untouched branches.

- [#275](https://github.com/ueberBrot/effect-api-query/pull/275) [`8863dd7`](https://github.com/ueberBrot/effect-api-query/commit/8863dd744480d8f806137c48cb49938df24de171) - Replace serialized path collision keys with a segment trie during utility tree construction, scan segments without intermediate slices, and build HTTP error-mapping structures only when needed.

- [#254](https://github.com/ueberBrot/effect-api-query/pull/254) [`6c2e9be`](https://github.com/ueberBrot/effect-api-query/commit/6c2e9be685ab2afd861a4f6f2fc104319bf7acd3) - Contract-derived hydration inspects decoded schema children, declaration type parameters (such as `Option<RedactedFromValue>`), and suspended schemas for `Redacted` values and throws `HydrationCodecError` (`UnencodableSchema`) unless overridden or opted out with `false`.

- [#259](https://github.com/ueberBrot/effect-api-query/pull/259) [`bca2fed`](https://github.com/ueberBrot/effect-api-query/commit/bca2fed98b7bf479d16fcf01e95a339cd3722478) - Screen arrays before Schema validation and equivalence during opt-in structural sharing. Reject incoming cycles through supported containers before callbacks and check each shared container once during cycle detection.

- [#275](https://github.com/ueberBrot/effect-api-query/pull/275) [`8863dd7`](https://github.com/ueberBrot/effect-api-query/commit/8863dd744480d8f806137c48cb49938df24de171) - Build canonical HTTP request keys without copying the whole request twice. Compare duplicate header values with Effect structural equality instead of serializing JSON, reuse default request-part schema encoders across endpoints, and skip allocating cycle trackers for primitive key values.

## 0.8.0

### Minor Changes

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Replace `queryEffects.fetch` and `queryEffects.ensure` with `queryEffects.query`. Use `queryEffects.infiniteQuery` for pages. The API also exposes cache operations, prefetching, and stream snapshots.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Build filters with `queryFilter` on utility roots, branches, and queryable leaves. Replace `createBranchQueryFilter` with this method. Use `createQueryFilter(leaf, view, encode)` for partial input.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Replace `defineUtilsPolicy` with `defineRpcPolicy` or `defineHttpApiPolicy`. Both infer policy types from the contract before you acquire a client.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Use a flat `paths` map in `configureUtils` to configure descendants. Put view options beside `interceptors` and mutation `callbacks`.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Pass `{ input }` to key builders for operations that take input. Add stream policy fields to the same object when the view accepts them.

- [#233](https://github.com/ueberBrot/effect-api-query/pull/233) [`e603455`](https://github.com/ueberBrot/effect-api-query/commit/e603455ecf5fb888c84417a9fab559c1fcc32624) - Contract hydration rejects `Schema.ObjectKeyword` without an explicit JSON encoding. Use a concrete JSON schema or supply a view codec to preserve the cached value.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Require Effect `>=4.1.4 <4.2.0` and TanStack Query Core `>=5.107.1 <6`.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Use `call` or `effect` on unary RPC and buffered HTTP leaves, including multipart endpoints. `call` runs through the leaf runtime. `effect` returns the client’s Effect. The utility tree reserves both names.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Replace the `runPromiseExit` factory option with `runtime`. Pass a runner function or an object with a `runPromiseExit` method, such as a `ManagedRuntime`.

### Patch Changes

- [#233](https://github.com/ueberBrot/effect-api-query/pull/233) [`e603455`](https://github.com/ueberBrot/effect-api-query/commit/e603455ecf5fb888c84417a9fab559c1fcc32624) - Pass a `ManagedRuntime` directly to `runQueryEvents` when its layers have no typed acquisition errors.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Pass Effect’s default tag-keyed RPC client directly to `createRpcQueryUtils`. Flat RPC clients remain supported.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Import typed utility and query-owner providers from `@ueberbrot/effect-api-query/react`. Install the optional React and TanStack React Query peers to use this entry point.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Use `bindReactivityInvalidation` to map Effect Reactivity keys to QueryClient invalidation filters. The subscription closes with its Scope.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Build each RPC or HTTP utility leaf on first access and reuse the frozen leaf on later reads. Factories still validate the tree up front.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Pass existing registries and individual view codecs together to `createHydrationRegistry`.

- [#233](https://github.com/ueberBrot/effect-api-query/pull/233) [`e603455`](https://github.com/ueberBrot/effect-api-query/commit/e603455ecf5fb888c84417a9fab559c1fcc32624) - HTTP hydration derives query and metadata codecs from successful responses without converting middleware error schemas.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Use `createContractHydrationRegistry` to derive codecs from an RPC or HTTP contract. Override individual views or supply a page-parameter codec for infinite queries.

- [#233](https://github.com/ueberBrot/effect-api-query/pull/233) [`e603455`](https://github.com/ueberBrot/effect-api-query/commit/e603455ecf5fb888c84417a9fab559c1fcc32624) - Stream snapshots wait for all accepted query functions to finish, including concurrent calls from a custom persister.

- [#233](https://github.com/ueberBrot/effect-api-query/pull/233) [`e603455`](https://github.com/ueberBrot/effect-api-query/commit/e603455ecf5fb888c84417a9fab559c1fcc32624) - A tracked `.call()` rejects after query owner retirement before invoking the ready client.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Omit `keyPrefix` to use the default cache roots. RPC uses `["rpc"]`. HTTP uses `["http", api.identifier]`.

- [#233](https://github.com/ueberBrot/effect-api-query/pull/233) [`e603455`](https://github.com/ueberBrot/effect-api-query/commit/e603455ecf5fb888c84417a9fab559c1fcc32624) - Pass `{ interruptOnRetire: true }` to `owner.wrapRunner` to interrupt an Effect when the query owner retires, even when the caller supplies no abort signal.

- [#233](https://github.com/ueberBrot/effect-api-query/pull/233) [`e603455`](https://github.com/ueberBrot/effect-api-query/commit/e603455ecf5fb888c84417a9fab559c1fcc32624) - Streamed queries flush buffered values before reporting a failure. Live queries cancelled before the first value report cancellation.

- [#233](https://github.com/ueberBrot/effect-api-query/pull/233) [`e603455`](https://github.com/ueberBrot/effect-api-query/commit/e603455ecf5fb888c84417a9fab559c1fcc32624) - Exact key builders reject `skipToken` before invoking custom key encoders. Use `input: skipToken` on query options to skip execution.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Inspect RPC and HTTP execution errors with `isEffectApiQueryError` and `getExecutionCause`. Use `matchDeclaredError` to handle tagged failures and `retryExecutionError` to set a retry limit.

- [#225](https://github.com/ueberBrot/effect-api-query/pull/225) [`678b6ac`](https://github.com/ueberBrot/effect-api-query/commit/678b6ac51935e909debcef963d8b56ee0ec58fff) - Use `QueryOwner.trackUtils` to track a utility tree’s queries and mutation functions for retirement. You can apply `configureUtils` before or after tracking.

- [#233](https://github.com/ueberBrot/effect-api-query/pull/233) [`e603455`](https://github.com/ueberBrot/effect-api-query/commit/e603455ecf5fb888c84417a9fab559c1fcc32624) - `flush` waits for other refetches to settle when a Reactivity invalidation binding throws.

- [#233](https://github.com/ueberBrot/effect-api-query/pull/233) [`e603455`](https://github.com/ueberBrot/effect-api-query/commit/e603455ecf5fb888c84417a9fab559c1fcc32624) - `QueryClientOperationError` is now a yieldable Effect tagged error. Its `cause` still holds the original QueryClient failure.

## 0.7.1

### Patch Changes

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Accumulate replacement stream history in one private buffer and publish it once after successful completion.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Cancel RPC and HTTP live queries cleanly when they abort before the first value. A stream that ends without a value still raises an empty-stream error.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Stop the Vite example from admitting queries while the retiring owner drains accepted mutations.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Flush pending stream batches and live values when the publication deadline passes during continuously ready pulls.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Reduce TypeScript work when consumers access many leaves of a large RPC utility tree.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Apply the Effect HTTP request parse options when building default query keys.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Include the normalized decoder options when inferring errors and runner requirements for HTTP SSE queries.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Infer errors and runner services from HTTP overloads that handle a subset of the declared request.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Create separate query and mutation caches for each owner and carry over callbacks from supplied caches.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - When HTTP header names differ only in case, compare their structured values without relying on object key order. Conflicting values still raise a key-generation error.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Preserve declared HTTP request parts supplied through getters or non-enumerable properties.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Apply metadata structural sharing and freeze the cached envelope when an interceptor returns a fallback.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Call HTTP client methods with their original receiver and avoid allocating a bound function for each request.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Reduce TypeScript work when inferring runner requirements for HTTP clients that mix standard methods and custom overloads.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Reduce the number of types TypeScript must instantiate when checking large HTTP utility trees.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Reduce TypeScript work when checking policies nested under `configureUtils` or `defineUtilsPolicy` scopes.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Release failed connection attempts before reconnecting and keep subsequent stream pulls independent of retry count.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Release the TanStack Start example clients even when a cache subscriber throws during disposal.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Expose the prepared input from loader descriptors when an input-bearing RPC decodes to undefined.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Track HTTP metadata queries in the Vite React example so retiring a query owner cancels those queries too.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Reuse the encode and decode functions for each hydration codec across cache entries.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Skip hashing when a cache key is too short or its view segment cannot match the branch query filter.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Skip hashing when a cache key is too short or its segments rule out the registered hydration codecs.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Copy HTTP SSE decoder options when applying a policy map so later edits to the original options cannot change configured keys or decoding.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Restore early matches for branch query filters whose leaves have different key lengths.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Check for cycles while sharing references in `schemaStructuralSharing`. This reduces work when updating large arrays of decoded records.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Accept native persister results in stream snapshots and block late query execution after timeout or cancellation.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Accept `sseOptions` in policy maps for streamed and live HTTP SSE queries. Call-site options take precedence.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Use Query Core's `query` method for `queryEffects.fetch` and `queryEffects.ensure`.

- [#222](https://github.com/ueberBrot/effect-api-query/pull/222) [`e544fa8`](https://github.com/ueberBrot/effect-api-query/commit/e544fa89ded66e8af1e5152c960fe73bbb485d6b) - Reduce the work needed to apply policies to selected branches or leaves of large utility trees.

## 0.7.0

### Minor Changes

- [#181](https://github.com/ueberBrot/effect-api-query/pull/181) [`d14f7b4`](https://github.com/ueberBrot/effect-api-query/commit/d14f7b45179222ea8e4e0d17f3870961c52826f8) - Add optional typed Effect operations over an application-supplied QueryClient, preserving shared fetching, unselected cache data, full execution Causes, and caller-only interruption.

- [#181](https://github.com/ueberBrot/effect-api-query/pull/181) [`d14f7b4`](https://github.com/ueberBrot/effect-api-query/commit/d14f7b45179222ea8e4e0d17f3870961c52826f8) - Add opt-in live snapshot coalescing with immediate first publication, fixed pending deadlines, final flush, and consistent configured cache identity.

  RPC live key types include an optional trailing policy tuple slot. This is a breaking type change released as a minor version below 1.0. Literal operation paths and query data/error tags remain intact.

- [#181](https://github.com/ueberBrot/effect-api-query/pull/181) [`d14f7b4`](https://github.com/ueberBrot/effect-api-query/commit/d14f7b45179222ea8e4e0d17f3870961c52826f8) - Support application-defined recovery cursors with explicit acceptance and gap policies while retaining numeric sequence convenience. Preserve connection and hook failure/service inference, scoped cleanup, retry and authoritative refresh behavior.

- [#181](https://github.com/ueberBrot/effect-api-query/pull/181) [`d14f7b4`](https://github.com/ueberBrot/effect-api-query/commit/d14f7b45179222ea8e4e0d17f3870961c52826f8) - Add opt-in Schema-defined reference sharing for immutable decoded atoms inside plain query-data containers, with explicit equivalence and native structural-sharing policies.

- [#181](https://github.com/ueberBrot/effect-api-query/pull/181) [`d14f7b4`](https://github.com/ueberBrot/effect-api-query/commit/d14f7b45179222ea8e4e0d17f3870961c52826f8) - Add `runQueryEvents` to consume application events against a query owner's native cache. Compose cursor recovery, typed updates and invalidation while retirement interrupts and drains consumption.

- [#181](https://github.com/ueberBrot/effect-api-query/pull/181) [`d14f7b4`](https://github.com/ueberBrot/effect-api-query/commit/d14f7b45179222ea8e4e0d17f3870961c52826f8) - Add optional acquired/borrowed query owner setup, precise accepted-work draining, guarded cache callbacks and idempotent retirement outside lifecycle-neutral factories. Register accepted work before starting it so immediate retirement still drains nested query runners and synchronous callbacks.

- [#181](https://github.com/ueberBrot/effect-api-query/pull/181) [`d14f7b4`](https://github.com/ueberBrot/effect-api-query/commit/d14f7b45179222ea8e4e0d17f3870961c52826f8) - Add typed loader descriptors with explicit input codecs and receiving-owner validation. Reuse selected input across independent server and browser owners with native hydration, providers and hooks.

### Patch Changes

- [#181](https://github.com/ueberBrot/effect-api-query/pull/181) [`d14f7b4`](https://github.com/ueberBrot/effect-api-query/commit/d14f7b45179222ea8e4e0d17f3870961c52826f8) - Make fetch/ensure Effects report QueryClientOperationError with the exact native rejection in cause. Foreign runner wrappers can no longer masquerade as the current query's declared failure. Generated wrappers and complete Effect Causes remain intact inside cause.

- [#181](https://github.com/ueberBrot/effect-api-query/pull/181) [`d14f7b4`](https://github.com/ueberBrot/effect-api-query/commit/d14f7b45179222ea8e4e0d17f3870961c52826f8) - Implement accumulated and live stream publication through stable Query Core cache operations, preserving existing stream policies, cancellation, and cleanup Causes while avoiding repeated full-cache scans.

## 0.6.1

### Patch Changes

- [#164](https://github.com/ueberBrot/effect-api-query/pull/164) [`56d6476`](https://github.com/ueberBrot/effect-api-query/commit/56d6476c6d69c35c371df6928ddeafa03f0649fe) - Support Effect 4.1 while retaining the 4.0.6 minimum. The Effect peer range is now `>=4.0.6 <4.2.0`.

## 0.6.0

### Minor Changes

- [#161](https://github.com/ueberBrot/effect-api-query/pull/161) [`260fa51`](https://github.com/ueberBrot/effect-api-query/commit/260fa5164f18a2aae3577a121518095a78bb371b) - Expose accumulated and live query builders for a single decoded HTTP `StreamNdjson` success, including declared response headers. Reuse stream retention, publication, snapshots, cancellation, and complete ready-client error and service inference. NDJSON uses the Effect declaration's decoder limits and has no SSE-specific options or key fields.

### Patch Changes

- [#158](https://github.com/ueberBrot/effect-api-query/pull/158) [`affa6a2`](https://github.com/ueberBrot/effect-api-query/commit/affa6a2e3e68a5096c0256a2a9f78f74474c3c24) - Reduce `configureUtils` overhead when applying sparse or repeated configuration to large utility trees.

- [#157](https://github.com/ueberBrot/effect-api-query/pull/157) [`c00e43c`](https://github.com/ueberBrot/effect-api-query/commit/c00e43cc17733fcc486d8ae08a9584ad014c5f16) - Allow newer Effect 4.0.x releases without peer-dependency conflicts. Effect 4.0.6 remains supported.

- [#160](https://github.com/ueberBrot/effect-api-query/pull/160) [`10075f5`](https://github.com/ueberBrot/effect-api-query/commit/10075f5c3a24eb7ce81c4dd54a91035e38fdd523) - Document and check opt-in structural sharing for immutable decoded Date, collection, Effect Option, and Schema class values using native Schema equivalence and Query policies. Cover nested reference reuse, explicit reference-only custom values, and frozen HTTP metadata without adding an export or changing defaults.

- [#156](https://github.com/ueberBrot/effect-api-query/pull/156) [`5d6e569`](https://github.com/ueberBrot/effect-api-query/commit/5d6e56909ff64f734d49ceaf93229769b7798034) - Remove obsolete pre-release migration instructions and links.

- [#159](https://github.com/ueberBrot/effect-api-query/pull/159) [`ee3d33e`](https://github.com/ueberBrot/effect-api-query/commit/ee3d33ef50ffe88519648f3876d917c032d8973d) - Lead the query-view hydration guide with typed codec registration and native snapshot preparation. Keep page-parameter codecs, stream cleanup, and metadata safety beside the workflows that need them.

## 0.5.0

### Minor Changes

- [#154](https://github.com/ueberBrot/effect-api-query/pull/154) [`2e586d9`](https://github.com/ueberBrot/effect-api-query/commit/2e586d9fddaebe1b58a938a702ce0f2920baada0) - Require Query Core >=5.104.4 <6 so infinite-query refetches preserve a cached null first page parameter.

### Patch Changes

- [#154](https://github.com/ueberBrot/effect-api-query/pull/154) [`2e586d9`](https://github.com/ueberBrot/effect-api-query/commit/2e586d9fddaebe1b58a938a702ce0f2920baada0) - Omit HTTP streaming request payloads and protocol upgrades from generated utility trees and their inferred types.

- [#154](https://github.com/ueberBrot/effect-api-query/pull/154) [`2e586d9`](https://github.com/ueberBrot/effect-api-query/commit/2e586d9fddaebe1b58a938a702ce0f2920baada0) - Preserve HTTP client service and error inference with Effect's streaming-payload generic. Service-free clients still need no runner; clients requiring services retain their runner requirement.

- [#154](https://github.com/ueberBrot/effect-api-query/pull/154) [`2e586d9`](https://github.com/ueberBrot/effect-api-query/commit/2e586d9fddaebe1b58a938a702ce0f2920baada0) - Update the exact Effect peer to 4.0.6. Applications must use the coordinated Effect 4.0.6 packages.

## 0.4.0

### Minor Changes

- [#151](https://github.com/ueberBrot/effect-api-query/pull/151) [`9b3565f`](https://github.com/ueberBrot/effect-api-query/commit/9b3565f84f25b96887f3589caf346076edc437d0) - Require accumulated stream keys and options to choose a positive `maxChunks` bound or `"unbounded"`. Set shared retention through `configureUtils` to omit it at call sites. Configured streams remain assignable to their original tree and leaf types.

- [#151](https://github.com/ueberBrot/effect-api-query/pull/151) [`9b3565f`](https://github.com/ueberBrot/effect-api-query/commit/9b3565f84f25b96887f3589caf346076edc437d0) - Infer native Vue results and React parallel-query selections and errors without explicit hook descriptors. Keep generic HTTP client errors and typed cache reads. Canonical payload slots are now opaque `unknown` values, and stream keys retain their fixed tuple shape.

  Reject generated mutation functions and keys in stored options and unions, and check extra builder options across every union member.

- [#151](https://github.com/ueberBrot/effect-api-query/pull/151) [`9b3565f`](https://github.com/ueberBrot/effect-api-query/commit/9b3565f84f25b96887f3589caf346076edc437d0) - Replace the separate policy, interceptor, and leaf-configuration helpers with `configureUtils` for trees, branches, and leaves. Preserve callback inference, scope specificity, and interceptor order across repeated configuration. Repeated mutation settings merge within their scope, and explicit `undefined` clears an inherited callback.

### Patch Changes

- [#151](https://github.com/ueberBrot/effect-api-query/pull/151) [`9b3565f`](https://github.com/ueberBrot/effect-api-query/commit/9b3565f84f25b96887f3589caf346076edc437d0) - Honor `sseOptions.dispatchEmptyNamedEvents` for HTTP streams. Validate its value and give enabled empty-event decoding a separate cache identity.

- [#151](https://github.com/ueberBrot/effect-api-query/pull/151) [`9b3565f`](https://github.com/ueberBrot/effect-api-query/commit/9b3565f84f25b96887f3589caf346076edc437d0) - Keep generated RPC utility trees and scoped configuration usable on large contracts without excessive TypeScript instantiation.

## 0.3.0

### Minor Changes

- [#145](https://github.com/ueberBrot/effect-api-query/pull/145) [`95a3c31`](https://github.com/ueberBrot/effect-api-query/commit/95a3c31b70e1e1a21fa9c4fcc54975b95182c7a9) - Add `createBranchQueryFilter` to select one query view across a generated root, branch, or leaf. It combines descendant view matching with native filter conditions and caller predicates without changing cache keys.

- [#145](https://github.com/ueberBrot/effect-api-query/pull/145) [`95a3c31`](https://github.com/ueberBrot/effect-api-query/commit/95a3c31b70e1e1a21fa9c4fcc54975b95182c7a9) - Add `configureQuery` and `configureMutation` to combine typed defaults and ordered interceptors on a frozen leaf while preserving every builder's inference. Local options override defaults, and mutation callback composition remains explicit.

- [#145](https://github.com/ueberBrot/effect-api-query/pull/145) [`95a3c31`](https://github.com/ueberBrot/effect-api-query/commit/95a3c31b70e1e1a21fa9c4fcc54975b95182c7a9) - Add `consumeEvents` to consume a native Effect Stream sequentially without caching history. It supports startup and exit callbacks, preserves handler failures, and runs the exit callback after stream cleanup. The application owns execution and resource lifetime.

- [#145](https://github.com/ueberBrot/effect-api-query/pull/145) [`95a3c31`](https://github.com/ueberBrot/effect-api-query/commit/95a3c31b70e1e1a21fa9c4fcc54975b95182c7a9) - Add `findDeclaredError` to return an Effect `Option` narrowed to one tagged failure. Defects, interruptions, composite Causes, and non-wrapper errors do not match; the original error and complete Cause remain available.

- [#145](https://github.com/ueberBrot/effect-api-query/pull/145) [`95a3c31`](https://github.com/ueberBrot/effect-api-query/commit/95a3c31b70e1e1a21fa9c4fcc54975b95182c7a9) - Add `prepareInput` to reuse construction, encoding, and canonicalization across repeated keys and query options on the same leaf. Retained execution inputs must remain unchanged. Handles cannot cross utility owners or replace mutation variables or infinite page mapper results.

- [#145](https://github.com/ueberBrot/effect-api-query/pull/145) [`95a3c31`](https://github.com/ueberBrot/effect-api-query/commit/95a3c31b70e1e1a21fa9c4fcc54975b95182c7a9) - Add `publicationMaxWaitMs` to accumulated streamed queries. Partial batches flush after the deadline even when the stream stays quiet, while cancellation awaits cleanup and preserves failures. An explicit deadline contributes to the stream key; omitted deadlines preserve existing keys and count-only behavior.

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
