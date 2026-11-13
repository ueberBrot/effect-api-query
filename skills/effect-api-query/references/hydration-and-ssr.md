# Capture, hydrate, and dispose request data

## Capture an open stream

Use a fresh request-owned QueryClient. Keep its ready clients, runner, and Scope alive until every capture and preparation settles. `queryClient.query` waits for stream completion. To capture the first new cache publication or normal completion, use `fetchStreamSnapshot`. It cancels that exact query and awaits local iterator cleanup.

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
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof updates>>,
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

The helper accepts RPC or HTTP accumulated and live options. Default `fresh` mode starts a new attempt even with initial or cached success. `append` retains existing history. A `replace` refetch of previously fetched data publishes only at completion. An indefinite replacement therefore needs completion or timeout. Explicit `mode: 'cached'` reuses successful data without starting or canceling work. If no successful entry exists, it falls back to fresh. Native `select` and QueryClient defaults apply.

During fresh capture, reserve the exact key exclusively. The query must be idle and unobserved. Until settlement, avoid same-key writes, observers, and concurrent fetches. An external manual publication can otherwise appear to be a stream emission. Other keys keep running. Configure hashing through QueryClient defaults. The helper rejects per-call `queryHash` and `queryKeyHashFn`.

Abort and timeout stop the wait for data. The helper then awaits cleanup before resolving or rejecting. `timeoutMs` does not bound finalization. Local settlement does not await acknowledgment of remote cancellation. After the helper settles, dispose client resources.

A local stream finalizer failure can reject capture after publication. Handle the adapter's execution error and preserved Cause before serializing the snapshot.

## Choose a consistent cache representation

The server and browser need equivalent contracts, inputs, safe prefixes, and hashing. Use independent QueryClients, clients, runners, and Scopes. To control the first browser refetch, choose `staleTime`. A new browser stream reconnects independently.

Use JSON-safe success DTOs in both caches. Alternatively, encode decoded domain values at the snapshot boundary and decode them during hydration. `select` changes observer data while the cache stays unchanged. `structuredClone` neither restores class prototypes nor supplies JSON codecs for bigint and bytes. The following synchronous paired codec preserves rich values through hydration and later contract refetch:

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
        defaultShouldDehydrateQuery(query) && query.queryKey[0] === "profile",
      serializeData: Schema.encodeUnknownSync(Profile),
    })
  );

export const hydrateProfile = (queryClient: QueryClient, json: string): void =>
  hydrate(queryClient, JSON.parse(json), {
    defaultOptions: { deserializeData: Schema.decodeUnknownSync(Profile) },
  });
```

Reserve this recipe's prefix for unary `Profile` data. On both sides, declare `Profile` as the operation success. The enclosing snapshot must come from the matching application encoder. Synchronous callbacks require service-free synchronous codecs.

For effectful or serviceful codecs, run application-owned preparation before native dehydration transport or hydration. Before publishing one snapshot, await all selected encodings. Before one native `hydrate` call, decode all selected entries. A failed decode then leaves the destination untouched. Keep preparation Effects and Promises out of query data. Supply codec services through the owning runtime.

Choose codecs for the complete view:

| View | Preserve |
| --- | --- |
| Infinite data | Every `pages` value and `pageParams` representation |
| Accumulated stream | Ordered decoded values, including distinct `undefined` and `null` |
| Live stream | Latest decoded value, with top-level `undefined` already normalized to `null` |
| HTTP decoded header wrapper | Body and decoded headers, reconstructing the wrapper |
| HTTP metadata | Decoded data with any declared wrapper, status, and approved raw string headers |

JSON turns undefined array elements into null. If accumulated history distinguishes them, use a tagged codec. A header wrapper with an undefined body remains a wrapper. Preserve that body separately. Encode all declared success alternatives and rich page parameters. The application supplies the codecs and serialization policy.

## Register query-view codecs and prepare the native snapshot

For generated query views, use typed registration and registry batch preparation. Follow the [query-view hydration guide](https://ueberbrot.github.io/effect-api-query/guides/hydrate-query-views/) for the registration, native `dehydrate`, registry encode/decode, and native `hydrate` sequence, with codecs for each cached representation.

Use `queryViewCodec(leaf, view, schema)` for ordinary, metadata, live, or accumulated data. The decoded type must match the view's cache data before `select`, including normalized nulls. Use `infiniteQueryCodec(leaf, { page, pageParam })` for explicit page and page-parameter codecs. One registration covers all inputs and policies for that leaf/view.

For a unary `rpc.profiles.read` leaf whose success is the `Profile` class above, import `createHydrationRegistry` and `queryViewCodec` from the package root and `Effect` from `effect`. Register and prepare its native snapshot:

```ts
const registry = createHydrationRegistry([
  queryViewCodec(rpc.profiles.read, "query", Profile),
]);
const encodeProfiles = Effect.fnUntraced(function* (queryClient: QueryClient) {
  const snapshot = dehydrate(queryClient, {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) && registry.matches(query.queryKey),
  });
  const queries = yield* registry.encodeQueries(snapshot.queries);
  return JSON.stringify({ ...snapshot, queries });
});
```

Use equivalent registration from the browser's independent utility tree. Parse the trusted snapshot, await `registry.decodeQueries(snapshot.queries)`, then pass its prepared queries to one native `hydrate`. The [complete registration recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/hydration-contract.ts) includes imports, contracts, rich views, and encoding/decoding service inference.

Pass registrations to `createHydrationRegistry`. Filter native dehydration with `registry.matches(query.queryKey)`, then await `registry.encodeQueries` on the snapshot's query array. On the browser, await `registry.decodeQueries` for the whole batch before calling native `hydrate` once. A failed preparation leaves the destination untouched; codec side effects are not rolled back. Encoding and decoding retain separate service requirements, supplied by the owning runtime.

Duplicate registrations throw `HydrationCodecError('DuplicateCodec')`. Batch preparation fails with `UnknownQuery` for an unregistered key or `UnsettledQuery` for unsuccessful or promise-bearing entries. Select successful settled entries. Errors, mutations, external-envelope validation, JSON transport, approved headers, and disposal remain application policy. For one synchronous service-free codec, `hydrationCallbacks(codec)` supplies native serialize/deserialize callbacks; restrict the snapshot to that codec's matching view.

To omit failed queries, retain `defaultShouldDehydrateQuery`. Custom error transfer must separately encode `state.error` and `state.fetchFailureReason`. Data codecs do not sanitize Causes, headers, or those fields. A safe error DTO does not automatically reconstruct package error classes. Before transport, apply the application's disclosure rules.

## Drain request work before disposal

Track query execution, accepted mutations, preparation, and snapshot captures in the request owner. On request completion or abort, stop accepting work. Abort pending preparation and captures, then cancel queries. Before closing clients or runtimes, drain accepted mutations and local finalizers. Canceling QueryClient work alone does not drain codec preparation or acknowledge finalization. Clear the request's private cache as part of its lifecycle. After hydration, the browser acquires independent resources.

When adding query persistence to the Start example, compose its application-owned persister. A replacement bypasses tracking of query and iterator cleanup.

Sources: [stream snapshots](https://ueberbrot.github.io/effect-api-query/guides/stream-snapshots/), [unary hydration](https://ueberbrot.github.io/effect-api-query/guides/hydrate-unary-data/), [query-view codecs](https://ueberbrot.github.io/effect-api-query/guides/hydrate-query-views/).

## Transfer loader selections across owners

Use `createQueryDescriptor(leaf, view, { contract, input: codec })` when a component must reuse a loader's selected input on an independent owner. Read the complete [loader/component example](https://ueberbrot.github.io/effect-api-query/guides/loader-descriptors/) before adding the transfer. `capture(input)` copies encoded strict JSON; `bind(unknown)` validates compatibility and semantic identity and returns the receiving leaf/view and its fresh prepared input. Pass that input to the matching native builder. The registration stays local, and the descriptor contains no data, clients, functions or prepared tokens.

Supply a synchronous service-free input codec, including explicit encodings for bigint, classes or other rich inputs. Preserve every execution-relevant field; equal encoded keys do not prove that a codec preserves hidden decoded state. Choose a public input DTO and safe keys; keep credentials in owner middleware. Version the application compatibility identifier when contract, codec or key meaning changes. Mismatched operation prefixes/views/contracts and changed canonical identities throw `QueryDescriptorError` before execution. Treat transferred selections as untrusted input, never authorization.

Reuse native providers, hooks and hydration. Configure matching stream policies on both owners, keep exclusive stream snapshot capture, and encode rich cached data separately. Inputless operations need an explicit void-to-JSON codec; infinite views keep page mapping and parameters local. Serialization, snapshot validation, script escaping, client lifetime and stale/refetch policy remain application-owned.
