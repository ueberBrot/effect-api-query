---
title: Hydrate Query Views
description: Register typed view codecs and prepare native snapshots for JSON hydration and refetch.
---

Register each cached representation with `queryViewCodec` or `infiniteQueryCodec`, then pass the registrations to `createHydrationRegistry`. Use native `dehydrate`, await registry encoding, and send the JSON snapshot. In the browser, await registry decoding before one native `hydrate` call. Keep decoded values in both Query Clients.

This task extends the [paired Profile codec](/effect-api-query/guides/hydrate-unary-data/). The server and browser own independent ready clients, runtimes, Scopes, and Query Clients. Use the same contract, input, key prefix, and Query Client hashing defaults on both sides.

## Register generated leaves and views

Import `queryViewCodec`, `infiniteQueryCodec`, and `createHydrationRegistry` from `@ueberbrot/effect-api-query`, and `Schema` from `effect`. Registration checks that the view exists and the codec's decoded type matches its cached data before `select`. The registry matches each generated leaf and view within your application's normal key prefix. Include the owner identity in that prefix when data depends on an owner.

The [typed registration recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/hydration-contract.ts) includes imports, contracts, and encoding/decoding service inference. Its `read` leaf returns `Profile`, and its `watch` leaf emits `Profile`, undefined, or null. Register ordinary and live data with codecs for their respective cached representations:

```ts
const viewRegistry = createHydrationRegistry([
  queryViewCodec(rpc.read, "query", Profile),
  queryViewCodec(rpc.watch, "live", Schema.NullOr(Profile)),
]);
```

Live queries normalize an entirely undefined emission to `null`, so their codec includes `null`. One registration matches every input and stream policy for that leaf and view. Register ordinary and metadata views separately. If application prefixes overlap, the most specific registered prefix selects the codec. Duplicate registrations throw `HydrationCodecError` with code `DuplicateCodec`.

## Prepare the native snapshot

Create equivalent registrations from the server's and browser's independently owned utility trees. After prefetching finite queries, dehydrate only successful registered queries and prepare the complete batch. Import `Effect` from `effect`, and `dehydrate`, `defaultShouldDehydrateQuery`, `hydrate`, and the `QueryClient` and `DehydratedState` types from `@tanstack/query-core` as shown in the typed recipe:

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

Run this Effect through the application's runner and await the returned JSON before publishing it through your framework. The original cache keeps decoded classes, bigint values, byte arrays, and page parameters.

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

Await this Effect before querying or mounting observers. Both registry methods return Effects. Required encoding and decoding services stay separate in their types; provide each through the application's runtime. Providing decoding services cannot satisfy encoding requirements, or vice versa. Codec failure or an unknown query prevents the prepared batch from reaching `hydrate`; the destination cache stays untouched. Successful earlier codec work can still have application effects. The registry performs no rollback of those effects.

Registry preparation accepts successful queries without pending promises. Unknown keys fail with `UnknownQuery`; unsuccessful or promise-bearing entries fail with `UnsettledQuery`. Select the queries to transfer with native dehydration options. The example omits mutations and failed-query errors and Causes. An omitted failed query remains available for a new browser fetch. Error hydration needs its own application-safe representation.

The registry validates query data and preserves the native snapshot envelope. Use the matching trusted server's envelope; validate arbitrary external snapshots separately. JSON transport, public-header selection, and resource disposal remain application decisions. Handle malformed JSON and preparation failures in the application's rendering or hydration error path. Keep Effects and Promises outside query data.

### Capture open streams before encoding

For an open HTTP or RPC stream, first await [fetchStreamSnapshot](/effect-api-query/guides/stream-snapshots/) with its exact generated stream options. It captures the first visible value and awaits local iterator cleanup. Keep exclusive ownership of that idle, unobserved key during capture. Prepare JSON after capture settles. Dispose the server's ready-client resources and runtime only after encoding finishes. Local cleanup does not acknowledge remote cancellation.

Choose native freshness defaults to control duplicate reads. A successful fresh hydrated query can reuse its reconstructed data. Later invalidation and refetch use the browser's independent ready client and the same decoded representation. For streams, explicit cached capture acquires no new work. Fresh capture starts the browser stream again.

## Choose codecs for the complete view

A success Schema describes one decoded result. Each cached representation needs its own codec:

| View | Preserve |
| --- | --- |
| Infinite data | Every page and its explicitly encoded page parameter |
| Accumulated stream | Ordered decoded elements, including distinct `undefined` and `null` |
| Live stream | Latest decoded value or normalized `null` |
| HTTP decoded header wrapper | Body and decoded headers, reconstructing the wrapper |
| HTTP metadata | Decoded data, response status, and approved raw string headers |

### Infinite pages and page parameters

The application chooses the page-parameter representation. For example, this `Cursor` encodes its offset as a decimal string and regains its prototype and methods during hydration:

```ts
export class Cursor extends Schema.Class<
  Cursor,
  { readonly brand: unique symbol }
>("Cursor")({
  offset: Schema.BigIntFromString,
}) {
  isStart(): boolean {
    return this.offset === 0n;
  }
}
```

Register both the page and page-parameter codecs, and include the registration in your registry:

```ts
const pages = infiniteQueryCodec(rpc.read, {
  page: Profile,
  pageParam: Cursor,
});
```

The page codec must match the leaf's query data. If your leaf returns a page containing rows and a next-page marker, use a codec for that whole page. `infiniteQueryCodec` encodes both the `pages` and `pageParams` arrays.

Use a `Cursor` as `infiniteOptions.initialPageParam` and return the next Cursor from `getNextPageParam`. Let the deterministic `input` mapper convert its offset into your contract's request input. Use the same page-parameter type in the options and registration. A result Schema alone cannot choose this representation, and registration cannot infer it.

### Accumulated history and undefined elements

Accumulated history preserves decoded `undefined` elements. Ordinary JSON turns an undefined array element into `null`, so encode it as a distinct tagged value. A real `null` remains `null`. Import `SchemaTransformation` from `effect` alongside `Schema`:

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
```

Register the array representation with the accumulated view and include it in your registry:

```ts
queryViewCodec(rpc.watch, "streamed", Schema.Array(HistoryElement));
```

### HTTP wrappers and metadata

For an HTTP header wrapper, normalization applies to the whole emitted value. A wrapper whose `body` is undefined remains a wrapper with an undefined body. The [wrapper codec definitions](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-hydration-views.ts) include `WrappedElement`, which preserves that body with the same tagged encoding and reconstructs the wrapper with `HttpApiSchema.withHeaders`. `WithHeaders` is an HTTP declaration. At the JSON boundary, use explicit codecs for the body and headers so rich body values and decoded numeric headers regain their types.

The same module's `BufferedProfile` codec includes both declared HTTP successes. Adapt that union to your endpoint and its status declarations. Register it for the ordinary query view. For metadata, encode the decoded response wrapper and the metadata envelope together:

```ts
const ProfileMetadata = Schema.Struct({
  data: BufferedProfile,
  status: Schema.Finite,
  headers: Schema.Record(Schema.String, Schema.String),
});
```

Register `ProfileMetadata` separately for the leaf's `metadata` view. For HTTP streams, register an array of `WrappedElement` for accumulated history or `WrappedElement` for the live view.

`ProfileMetadata` preserves decoded data, numeric status, and raw string headers. Hydrated envelopes belong to the application and remain unfrozen. A later metadata fetch produces the library's frozen envelope and raw headers again. Decoded data stays mutable. Before sending metadata that contains private values, select public response headers. Data codecs do not sanitize headers or error Causes.

## Use native callbacks for one synchronous view

For a single service-free registration whose codec completes synchronously, `hydrationCallbacks(codec)` provides native `serializeData` and `deserializeData` callbacks. Restrict dehydration to `codec.matches(query.queryKey)` and successful queries. Native callbacks receive only data, so use a registry batch for multiple representations. Synchronous hydration callbacks can fail after earlier cache writes; use `decodeQueries` before `hydrate` when the complete batch must pass validation first.
