# Capture, hydrate, and dispose request data

## Capture an open stream

Give each server request a QueryClient and keep its Effect resources alive through capture and preparation. An imperative query waits for stream completion. Use `fetchStreamSnapshot` for the first new publication or normal completion. It cancels the exact query and waits for its iterator cleanup.

```ts
import { dehydrate } from "@tanstack/query-core";
import type { QueryClient } from "@tanstack/query-core";
import {
  createRpcQueryUtils,
  fetchStreamSnapshot,
} from "@ueberbrot/effect-api-query";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient } from "effect/rpc";

export const updates = RpcGroup.make(
  Rpc.make("updates.watch", {
    payload: { channel: Schema.String },
    success: Schema.String,
    stream: true,
  })
);

export async function captureUpdates(
  queryClient: QueryClient,
  client: RpcClient.RpcClient<RpcGroup.Rpcs<typeof updates>>,
  signal: AbortSignal
) {
  const rpc = createRpcQueryUtils(updates, {
    client,
    keyPrefix: ["updates-app"],
  });
  const options = rpc.updates.watch.streamedOptions({
    input: { channel: "news" },
    maxChunks: 20,
    retry: false,
  });
  await fetchStreamSnapshot(queryClient, options, { signal, timeoutMs: 5_000 });
  return dehydrate(queryClient, { shouldDehydrateMutation: () => false });
}
```

Use accumulated or live options for RPC, SSE, or NDJSON. The default `fresh` mode starts a new attempt even if initial or cached data exists. `append` includes prior history. A `replace` refetch publishes on completion. Use `mode: 'cached'` to reuse successful data without starting work. Without a success, it starts fresh. Native selection and defaults still apply.

Reserve an idle, unobserved exact key for fresh capture. Keep same-key writes, observers, and concurrent fetches away until it settles. Other keys keep running. Configure hashing on QueryClient.

Abort and `timeoutMs` end the wait for data. Before settlement, the helper still waits for local cleanup. Await any remote acknowledgement separately. Dispose resources after capture settles.

A finalizer failure can reject capture even after data appears. Inspect the execution error and Cause before serialization.

## Choose a consistent cache representation

Use equivalent declarations, inputs, safe prefixes, and hashing across server and browser. Give them separate clients, QueryClients, runtimes, and Scopes. Set `staleTime` for browser refetch behavior. A new browser stream uses its own client.

For JSON-safe values, cache the same DTO on both sides. For rich values, encode at transfer and decode before hydration. Selection leaves cached data intact. `structuredClone` copies data without the class prototype and is not a JSON codec. This codec restores the class and rich fields on hydration and refetch.

```ts
import {
  defaultShouldDehydrateQuery,
  dehydrate,
  hydrate,
} from "@tanstack/query-core";
import type { QueryClient } from "@tanstack/query-core";
import { Schema } from "effect";

export class Profile extends Schema.Class<
  Profile,
  { readonly brand: unique symbol }
>("Profile")({
  name: Schema.String,
  credits: Schema.BigIntFromString,
  avatar: Schema.Uint8ArrayFromBase64,
}) {
  summary() {
    return `${this.name}: ${this.credits} credits`;
  }
}

export const snapshotProfile = (queryClient: QueryClient): string =>
  JSON.stringify(
    dehydrate(queryClient, {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query) =>
        defaultShouldDehydrateQuery(query) &&
        query.state.error === null &&
        query.state.fetchFailureReason === null &&
        query.queryKey[0] === "profile",
      serializeData: Schema.encodeUnknownSync(Profile),
    })
  );

export const hydrateProfile = (queryClient: QueryClient, json: string): void =>
  hydrate(queryClient, JSON.parse(json), {
    defaultOptions: { deserializeData: Schema.decodeUnknownSync(Profile) },
  });
```

Reserve this prefix for unary `Profile` data. Both clients must declare that result. Use a snapshot from your matching encoder. Run only service-free, synchronous codecs in native callbacks.

If a codec uses services or asynchronous work, await all encoding before publishing the snapshot. Decode all entries before a single native `hydrate` call. A failed decode keeps the destination cache untouched. Supply services through the owning runtime. Keep Effects and Promises out of query data.

Choose the codec for the full cached shape.

| View | Preserve |
| --- | --- |
| Infinite data | Every `pages` value and `pageParams` representation |
| Accumulated stream | Ordered decoded values, including distinct `undefined` and `null` |
| Live stream | Latest decoded value, with top-level `undefined` already normalized to `null` |
| HTTP decoded header wrapper | Body and decoded headers, reconstructing the wrapper |
| HTTP metadata | Decoded data with any declared wrapper, status, and approved raw string headers |

Use a tagged codec for `undefined` history elements so JSON distinguishes them from `null`. An HTTP wrapper with an undefined body still contains the body field. Encode each declared success and rich page parameter.

## Derive query-view codecs and prepare the native snapshot

Call `createContractHydrationRegistry(groupOrApi)` without a client. If utilities use a `keyPrefix`, supply the same tuple to the registry. Combine RPC and HTTP registries and manual codecs with `createHydrationRegistry`.

Derivation covers buffered queries, live values, and accumulated history by default. HTTP metadata hydration is opt-in so unfiltered server-only response headers never enter snapshots by default: pass `views: { metadata: { headers: ["etag"] } }` (or `headers: []` for status and data only), a per-path `paths[path].metadata: { headers: [...] }`, or a custom `metadata` codec. Derivation preserves decoded header wrappers, `HttpApiSchema.asNoContent` cached decoded values, overlapping union members in objects and arrays, and distinct `undefined` and `null` stream elements. For endpoints with several success statuses, HTTP metadata uses the cached status to select the corresponding schemas. Hydration filters raw headers to the allowlist and rebuilds a frozen metadata envelope. Buffered HTTP query data has no status, so derivation prefers a success schema that accepts all cached fields. Use matching package versions and contract declarations on both sides of the snapshot.

Add `paths["users.page"].infinite: { pageParam: Cursor }` for infinite data. A custom query codec supplies the default metadata data and infinite page codec. Set `views` or path settings directly on the configuration objects to opt out with `false`. Use `Schema.Json` for JSON values. Supply a JSON codec or opt out for unrestricted `Schema.Any`, `Schema.Unknown`, `Schema.ObjectKeyword`, opaque schemas, or `Redacted` schemas (including nested `Redacted` inside `Option`, structs, unions, arrays, or `Schema.suspend`).

### Register a custom view

Use the [hydration guide](https://ueberbrot.github.io/effect-api-query/guides/hydrate-query-views/) for native dehydration and registry batch preparation.

Register ordinary, metadata, live, or accumulated views with `queryViewCodec(leaf, view, schema)`. Match the cached data before `select`, including normalized nulls. Use `infiniteQueryCodec(leaf, { page, pageParam })` for pages. One registration covers all inputs and stream policies of that view.

Import `createHydrationRegistry` and `queryViewCodec` from the library and `Effect` from `effect`. Register and prepare the unary `Profile` snapshot.

```ts
const registry = createHydrationRegistry([
  queryViewCodec(rpc.profiles.read, "query", Profile),
]);
const encodeProfiles = Effect.fnUntraced(function* (queryClient: QueryClient) {
  const snapshot = dehydrate(queryClient, {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) &&
      query.state.error === null &&
      query.state.fetchFailureReason === null &&
      registry.matches(query.queryKey),
  });
  const queries = yield* registry.encodeQueries(snapshot.queries);
  return JSON.stringify({ ...snapshot, queries });
});
```

Create equivalent registrations from the browser tree. Parse the trusted snapshot, decode its queries with `registry.decodeQueries`, then pass the batch to native `hydrate`. See the [typed example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/hydration-contract.ts).

On the server, filter dehydration with `registry.matches(query.queryKey)` and await `registry.encodeQueries`. A preparation failure prevents the cache write. Earlier codec side effects can still occur. Supply the separate encoding and decoding services in the owning runtime.

A duplicate registration throws `HydrationCodecError` with `DuplicateCodec`. Preparation reports `UnknownQuery` for unmatched keys and `UnsettledQuery` for unsuccessful or promise-bearing entries. Select settled successes. For one synchronous service-free codec, use `hydrationCallbacks(codec)` on matching entries.

For public snapshots, select successful queries and require both `state.error` and `state.fetchFailureReason` to be `null`. Query Core can retain a failure reason after status returns to success. To send a public failure, encode both fields separately, allowlist public values and headers, and reconstruct error behavior in the browser.

## Drain request work before disposal

On request completion or abort, stop accepting work. Abort preparation and captures, then cancel queries. Await accepted mutations, preparation, and local finalizers before clearing the private cache and closing the client. Canceling native queries alone can finish too early.

When adding persistence to Start, compose the example's persister so it still tracks query and iterator cleanup.

See [stream snapshots](https://ueberbrot.github.io/effect-api-query/guides/stream-snapshots/) and [unary hydration](https://ueberbrot.github.io/effect-api-query/guides/hydrate-unary-data/) for complete examples.

## Transfer loader selections across owners

Use `createQueryDescriptor(leaf, view, { contract, input: codec })` to transfer a loader selection across owners. `capture(input)` copies encoded JSON. `bind(unknown)` checks it and supplies the receiving leaf, view, and fresh prepared input. Pass that input to the native builder. Follow the [loader example](https://ueberbrot.github.io/effect-api-query/guides/loader-descriptors/).

Use a synchronous, service-free codec and encode rich values explicitly. Preserve every value that affects execution, even if it stays outside the key. Change the compatibility ID when the contract, codec, or key meaning changes. Handle synchronous `QueryDescriptorError` by loading a fresh selection. Use public input and validate authorization at execution.

Match stream policy on both sides and reserve the exact key for capture. Encode cached data separately. For inputless operations, use a codec from void to JSON. For infinite queries, use native options with a local page mapper. Validate the snapshot envelope and escape it for the application transport.
