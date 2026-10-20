---
title: Hydrate Query Views
description: Preserve infinite pages, stream histories, live values, and HTTP metadata across JSON hydration and refetch.
---

Choose one codec for each cached representation. A success Schema describes a decoded result. Infinite pages also contain page parameters, and HTTP metadata adds an envelope. Keep decoded values in the Query Client. Encode only the snapshot sent to the browser.

This task extends the [paired Profile codec](/effect-api-query/guides/hydrate-unary-data/). The server and browser own independent ready clients, runtimes, Scopes, and Query Clients. Use the same contract, input, key prefix, and Query Client hashing defaults on both sides.

## Give each view an explicit codec

Reserve a key prefix of `['hydration-views', codecId, ...applicationIdentity]` when creating each utility tree. The generated key suffix retains its usual operation, input, and view policies. Choose `codecId` from the map below. If data depends on an owner, add the owner identity after it.

| Codec ID | Cached representation |
| --- | --- |
| `history` | Ordered `Profile`, `undefined`, and `null` elements |
| `infinite` | Profile pages and explicitly encoded `Cursor` page parameters |
| `live` | Latest Profile or normalized `null` |
| `buffered` | Decoded HTTP header wrapper with either declared success |
| `metadata` | Buffered wrapper, response status, and raw string headers |
| `wrapped-history` | Ordered decoded HTTP header wrappers |
| `wrapped-live` | Latest decoded HTTP header wrapper |

Define the view codecs in the application's hydration module. Import `Schema` and `SchemaTransformation` from `effect`. Reuse the paired `Profile` codec. The [complete typed recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-hydration-views.ts) includes wrapper codecs, codec dispatch, and awaited snapshot preparation.

Use the linked module's `Cursor` and `BufferedProfile` declarations alongside these codecs. For infinite data, encode both pages and page parameters:

```ts
export const ProfilePage = Schema.Struct({
  rows: Schema.Array(Profile),
  next: Schema.NullOr(Schema.Finite),
});
const ProfilePages = Schema.Struct({
  pages: Schema.Array(ProfilePage),
  pageParams: Schema.Array(Cursor),
});
```

For history, preserve an undefined element separately from a real `null`:

```ts
const UndefinedElement = Schema.Struct({
  _tag: Schema.Literal("Undefined"),
}).pipe(
  Schema.decodeTo(
    Schema.Undefined,
    SchemaTransformation.transform({
      decode: () => undefined,
      encode: () => ({ _tag: "Undefined" as const }),
    })
  )
);

export const HistoryElement = Schema.Union([
  Profile,
  Schema.Null,
  UndefinedElement,
]);
const ProfileHistory = Schema.Array(HistoryElement);
```

For HTTP metadata, encode the decoded response wrapper and the metadata envelope:

```ts
const ProfileMetadata = Schema.Struct({
  data: BufferedProfile,
  status: Schema.Finite,
  headers: Schema.Record(Schema.String, Schema.String),
});
```

Use a `Cursor` as `infiniteOptions.initialPageParam`. Return the next Cursor from `getNextPageParam`. Let the deterministic `input` mapper convert its offset into your contract's request input. `ProfilePages` encodes both arrays. Page parameters become decimal strings at the JSON boundary and regain their Cursor prototype and methods during hydration. A result Schema alone cannot choose this page-parameter representation.

Accumulated history preserves decoded `undefined` elements. Ordinary JSON turns an undefined array element into `null`, so `UndefinedElement` encodes it as a distinct tagged value. A real `null` remains `null`. Live queries already normalize an entirely undefined emission to `null`. Their codec retains that value.

For an HTTP header wrapper, normalization applies to the whole emitted value. A wrapper whose `body` is undefined remains a wrapper with an undefined body. `WrappedElement` preserves that body with the same tagged encoding and reconstructs the wrapper with `HttpApiSchema.withHeaders`. `WithHeaders` is an HTTP declaration. At the JSON boundary, use explicit codecs for the body and headers so rich body values and decoded numeric headers regain their types.

`BufferedProfile` includes both declared HTTP successes. Adapt that union to your endpoint and its status declarations. `ProfileMetadata` preserves decoded data, numeric status, and raw string headers. Hydrated envelopes belong to the application and remain unfrozen. A later metadata fetch produces the library's frozen envelope and raw headers again. Decoded data stays mutable. Before sending metadata that contains private values, select public response headers.

## Register generated leaves and views

Use the optional `queryViewCodec`, `infiniteQueryCodec`, and `createHydrationRegistry` helpers from `@ueberbrot/effect-api-query` to replace application prefix dispatch. Registration checks that the view exists and the codec's decoded type matches its cached data before `select`. One registration matches every input and stream policy for that leaf and view. If application prefixes overlap, the most specific registered prefix selects the codec. Register ordinary and metadata views separately. Duplicate registrations throw `HydrationCodecError` with code `DuplicateCodec`.

The [typed registration recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/hydration-contract.ts) uses a `read` leaf returning `Profile` and a `watch` leaf emitting `Profile`, undefined, or null. It reuses this guide's `Cursor` and `HistoryElement` codecs:

```ts
const viewRegistry = createHydrationRegistry([
  queryViewCodec(rpc.read, "query", Profile),
  infiniteQueryCodec(rpc.read, { page: Profile, pageParam: Cursor }),
  queryViewCodec(rpc.watch, "streamed", Schema.Array(HistoryElement)),
  queryViewCodec(rpc.watch, "live", Schema.NullOr(Profile)),
]);
```

`infiniteQueryCodec` requires both `page` and `pageParam`. The page codec must match the leaf's query data. The application chooses the page-parameter codec and uses that same type in its infinite options. Registration cannot infer page parameters from a result Schema. For the pagination contract earlier in this guide, use `page: ProfilePage`.

Create equivalent registrations from the server's and browser's independently owned utility trees. Keep decoded values in the server cache and encode only native dehydrated query batches:

```ts
const prepareRegisteredSnapshot = Effect.fnUntraced(function* (
  queryClient: QueryClient
) {
  const snapshot = dehydrate(queryClient, {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) &&
      viewRegistry.matches(query.queryKey),
  });
  const queries = yield* viewRegistry.encodeQueries(snapshot.queries);
  return JSON.stringify({ ...snapshot, queries });
});
```

On the browser, prepare the full batch before the native cache write:

```ts
const hydrateRegisteredSnapshot = Effect.fnUntraced(function* (
  queryClient: QueryClient,
  json: string
) {
  const snapshot: DehydratedState = JSON.parse(json);
  const queries = yield* viewRegistry.decodeQueries(snapshot.queries);
  hydrate(queryClient, { ...snapshot, queries });
});
```

Both registry methods return Effects. Required encoding and decoding services stay separate in their types. Provide them through the application's runtime and await preparation. Codec failure or an unknown query prevents the prepared batch from reaching `hydrate`; the destination cache stays untouched. Successful earlier codec work can still have application effects. The registry performs no rollback of those effects.

Registry preparation accepts successful queries without pending promises. Unknown keys fail with `UnknownQuery`; unsuccessful or promise-bearing entries fail with `UnsettledQuery`. Select the queries to transfer with native dehydration options. Mutations, errors, envelope validation, JSON transport, public-header selection, and resource disposal remain application decisions. The registry validates query data and preserves the native snapshot envelope. It does not validate arbitrary external snapshots or assign one homogeneous data type to a heterogeneous batch.

For a single service-free registration whose codec completes synchronously, `hydrationCallbacks(codec)` provides native `serializeData` and `deserializeData` callbacks. Restrict dehydration to `codec.matches(query.queryKey)` and successful queries. Native callbacks receive only data, so use a registry batch for multiple representations. Synchronous hydration callbacks can fail after earlier cache writes; use `decodeQueries` before `hydrate` when the complete batch must pass validation first.

## Prepare the complete snapshot before continuing

After prefetching finite queries, run `prepareViewSnapshot(serverQueryClient)` through the application's runner with `SnapshotEncoding` provided. Supply asynchronous encoding work through `beforeEncode`. Await the returned JSON before publishing it through your framework. The original cache keeps decoded classes, bigint values, byte arrays, and page parameters.

For an open HTTP or RPC stream, first await [fetchStreamSnapshot](/effect-api-query/guides/stream-snapshots/) with its exact generated stream options. It captures the first visible value and awaits local iterator cleanup. Keep exclusive ownership of that idle, unobserved key during capture. After capture settles, prepare JSON and dispose the server's ready-client resources. Local cleanup does not acknowledge remote cancellation.

On the browser, provide `SnapshotDecoding` and await `prepareViewHydration(browserQueryClient, json)` before querying or mounting observers. Encoding and decoding require separate services. One cannot satisfy the other. Preparation decodes all selected data before a single native `hydrate` call. Invalid codec data or an unknown codec ID leaves the browser cache untouched.

The preparation helpers accept the matching trusted server's native dehydrated envelope and validate selected query data. Validate arbitrary external snapshots separately. Handle malformed JSON and preparation failures in the application's rendering or hydration error path.

Only successful queries in the reserved family enter the snapshot. Mutations and failed-query errors and Causes are omitted. Hydration leaves an omitted failed query available for a new browser fetch. Error hydration needs its own application-safe representation.

Choose native freshness defaults to control duplicate reads. A successful fresh hydrated query can reuse its reconstructed data. Later invalidation and refetch use the browser's independent ready client and the same decoded representation. For streams, explicit cached capture acquires no new work. Fresh capture starts the browser stream again. Keep Effects and Promises outside query data. Finish preparation before publishing or hydrating.
