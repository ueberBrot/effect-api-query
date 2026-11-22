---
title: Hydrate Query Views
description: Register typed view codecs and prepare native snapshots for JSON hydration and refetch.
---

Derive view codecs from your Effect contract with `createContractHydrationRegistry`. On the server, dehydrate the cache and await encoding. In the browser, await decoding before one native `hydrate` call. Both caches hold decoded data.

This example extends the [Profile codec](/effect-api-query/guides/hydrate-unary-data/). Give server and browser separate clients, runtimes, Scopes, and QueryClients. Use the same contract, input, prefix, and hashing defaults.

## Derive a registry from the contract

Pass the RPC group or HttpApi directly. The registry uses the same keys as the utility tree. If you set `keyPrefix` on the utilities, pass it here too. See the [Start snapshot module](https://github.com/ueberBrot/effect-api-query/blob/main/examples/tanstack-start/src/lib/snapshot-preparation.ts) for composing RPC and HTTP registries with `createHydrationRegistry`.

Derivation covers buffered queries, HTTP metadata, live values, and accumulated history. Use `paths` to override a view or register infinite pages with `infinite: { pageParam }`. A custom `query` codec also supplies the decoded data codec for metadata and pages unless you override them.

Derivation preserves top-level union members that share a JSON representation, such as `42n` and `"42"`. It keeps `undefined` and `null` distinct in accumulated history. When an endpoint declares multiple success statuses, HTTP metadata uses the cached response status to select the corresponding schemas. For buffered HTTP query data, the registry prefers a success schema that accepts all cached fields.

Use matching package versions and contract declarations on both sides of the snapshot. Supply a custom view codec if your schema needs to disambiguate a union inside an object field.

Set a global view in `views` to `false` to omit it, or set a path or one of its views to `false`. Set overrides directly on their configuration objects. Opaque or unencodable schemas such as `Redacted` require an override or opt-out. The registry throws `HydrationCodecError` during setup if it cannot derive a codec.

### Register a hand-written codec

Use `queryViewCodec` and `infiniteQueryCodec` when you want to register an individual view. The codec’s decoded type must match the data cached before `select`. The [typed example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/hydration-contract.ts) includes the contract and imports. Its `read` leaf returns `Profile` and its `watch` leaf emits `Profile`, `undefined`, or `null`. Register each view's cached type.

```ts
const viewRegistry = createHydrationRegistry([
  queryViewCodec(rpc.read, "query", Profile),
  queryViewCodec(rpc.watch, "live", Schema.NullOr(Profile)),
]);
```

The live codec includes `null` because live queries convert whole `undefined` emissions. A registration covers every input and stream policy for that leaf and view. Register ordinary and metadata views separately. If prefixes overlap, the most specific one wins. A duplicate registration throws `HydrationCodecError` with code `DuplicateCodec`.

## Prepare the native snapshot

Create matching registrations from the server and browser trees. Prefetch finite queries, then dehydrate only successful registered entries. Import `Effect` from `effect`. Import `dehydrate`, `defaultShouldDehydrateQuery`, `hydrate`, `QueryClient`, and `DehydratedState` from `@tanstack/query-core`.

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

Run the Effect and await the JSON before publishing it. The server cache keeps decoded classes, bigint values, bytes, and page parameters.

Decode the entire batch before writing to the browser cache.

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

Await decoding before mounting observers. The registry returns Effects with separate encoding and decoding service requirements. Supply both through your runtime. An unknown query or failed codec stops preparation before `hydrate`. Earlier codec side effects can still take place.

Prepare successful queries without pending promises. `UnknownQuery` means no codec matched the key. `UnsettledQuery` means the entry failed, is still pending, or carries a promise. Use native dehydration filters to omit mutations and failed queries. The browser can refetch omitted reads. Define your own safe representation if you transfer errors.

Use envelopes from the matching trusted server. The registry checks query data and preserves the native snapshot envelope. Validate arbitrary external envelopes separately. Handle malformed JSON or preparation errors in your hydration path. Keep Effects and Promises out of query data.

### Capture open streams before encoding

For an open stream, await [fetchStreamSnapshot](/effect-api-query/guides/stream-snapshots/) with its exact options. Reserve the idle, unobserved key until capture and local cleanup finish. Encode after capture, then dispose of the server client and runtime. If you need remote acknowledgement, request it separately.

Use freshness defaults to control refetches after hydration. The next fetch uses the browser client and returns the same decoded data shape. Cached stream capture can reuse existing successful data. Fresh capture starts a new stream attempt.

## Choose codecs for the complete view

Write the codec for what the cache holds. A success Schema describes one decoded result.

| View | Preserve |
| --- | --- |
| Infinite data | Every page and its explicitly encoded page parameter |
| Accumulated stream | Ordered decoded elements, including distinct `undefined` and `null` |
| Live stream | Latest decoded value or normalized `null` |
| HTTP decoded header wrapper | Body and decoded headers, reconstructing the wrapper |
| HTTP metadata | Decoded data, response status, and approved raw string headers |

### Infinite pages and page parameters

Choose how to encode page parameters. This `Cursor` stores its offset as a decimal string and reconstructs its methods on decode.

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

Register the codec for each page and its parameter.

```ts
const pages = infiniteQueryCodec(rpc.read, {
  page: Profile,
  pageParam: Cursor,
});
```

Match the page codec to the leaf's query data. If a page includes rows and a next-page marker, preserve both. `infiniteQueryCodec` encodes the `pages` and `pageParams` arrays.

Set a `Cursor` in `infiniteOptions.initialPageParam` and return the next one from `getNextPageParam`. Convert the offset to request input in the mapper. The options and codec must agree on the parameter type.

### Accumulated history and undefined elements

To preserve `undefined` in an accumulated history, give it a tagged encoding. JSON turns undefined array elements into `null`, so encode them separately from real `null`. Import `SchemaTransformation` and `Schema` from `effect`.

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

Register the history array for the accumulated view.

```ts
queryViewCodec(rpc.watch, "streamed", Schema.Array(HistoryElement));
```

### HTTP wrappers and metadata

An HTTP header wrapper with an undefined body stays a wrapper. The [wrapper example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-hydration-views.ts) uses `WrappedElement` and `HttpApiSchema.withHeaders`. Encode body and headers explicitly so decoded values, such as numeric headers, regain their types.

The example's `BufferedProfile` codec covers both declared HTTP successes. Match that union to your endpoint's successes and statuses. For metadata, encode both the decoded data and the status and header envelope.

```ts
const ProfileMetadata = Schema.Struct({
  data: BufferedProfile,
  status: Schema.Finite,
  headers: Schema.Record(Schema.String, Schema.String),
});
```

Register `ProfileMetadata` for the `metadata` view. For HTTP streams, use an array of `WrappedElement` for accumulated history or one `WrappedElement` for live data.

`ProfileMetadata` preserves decoded data, numeric status, and raw string headers. Contract-derived metadata codecs freeze the decoded envelope and raw header map. If you register your own full metadata codec, it controls the decoded envelope. Transfer only public headers and keep private values out of error Causes you serialize.

## Use native callbacks for one synchronous view

For one synchronous, service-free codec, use `hydrationCallbacks(codec)` for native `serializeData` and `deserializeData`. Dehydrate only successful entries that match `codec.matches(query.queryKey)`. Use a registry for multiple views. A synchronous callback can fail after earlier writes. If the whole batch must pass first, call `decodeQueries` before `hydrate`.
