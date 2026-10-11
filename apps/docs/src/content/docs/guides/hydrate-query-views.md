---
title: Hydrate Query Views
description: Preserve infinite pages, stream histories, live values, and HTTP metadata across JSON hydration and refetch.
---

Choose one codec for each cached representation. A success Schema describes a decoded result;
infinite pages also contain page parameters, and HTTP metadata adds an envelope. Keep decoded
values in the Query Client and encode only the snapshot sent to the browser.

This task extends the [paired Profile codec](/effect-api-query/guides/hydrate-unary-data/).
The server and browser own independent ready clients, runtimes, Scopes, and Query Clients.
Use the same contract, input, key prefix, and Query Client hashing defaults on both sides.

## Give each view an explicit codec

Reserve a key prefix of `['hydration-views', codecId, ...applicationIdentity]` when creating each
utility tree. The generated key suffix retains its usual operation, input, and view policies.
Choose `codecId` from the map below; add your owner identity after it when data depends on an owner.

| Codec ID          | Cached representation                                         |
| ----------------- | ------------------------------------------------------------- |
| `history`         | Ordered `Profile`, `undefined`, and `null` elements           |
| `infinite`        | Profile pages and explicitly encoded `Cursor` page parameters |
| `live`            | Latest Profile or normalized `null`                           |
| `buffered`        | Decoded HTTP header wrapper with either declared success      |
| `metadata`        | Buffered wrapper, response status, and raw string headers     |
| `wrapped-history` | Ordered decoded HTTP header wrappers                          |
| `wrapped-live`    | Latest decoded HTTP header wrapper                            |

Define the view codecs in the application's hydration module. Import `Schema` and
`SchemaTransformation` from `effect`; reuse the paired `Profile` codec. The
[complete typed recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-hydration-views.ts)
includes wrapper codecs, codec dispatch, and awaited snapshot preparation.

Use the linked module's `Cursor` and `BufferedProfile` declarations alongside these codecs.
For infinite data, encode both pages and page parameters:

```ts
export const ProfilePage = Schema.Struct({
  rows: Schema.Array(Profile),
  next: Schema.NullOr(Schema.Finite),
})
const ProfilePages = Schema.Struct({
  pages: Schema.Array(ProfilePage),
  pageParams: Schema.Array(Cursor),
})
```

For history, preserve an undefined element separately from a real `null`:

```ts
const UndefinedElement = Schema.Struct({ _tag: Schema.Literal('Undefined') }).pipe(
  Schema.decodeTo(
    Schema.Undefined,
    SchemaTransformation.transform({
      decode: () => undefined,
      encode: () => ({ _tag: 'Undefined' as const }),
    }),
  ),
)

export const HistoryElement = Schema.Union([Profile, Schema.Null, UndefinedElement])
const ProfileHistory = Schema.Array(HistoryElement)
```

For HTTP metadata, encode the decoded response wrapper and the metadata envelope:

```ts
const ProfileMetadata = Schema.Struct({
  data: BufferedProfile,
  status: Schema.Finite,
  headers: Schema.Record(Schema.String, Schema.String),
})
```

Use a `Cursor` as `infiniteOptions.initialPageParam`. Return the next Cursor from
`getNextPageParam`, and let the deterministic `input` mapper convert its offset into your
contract's request input. `ProfilePages` encodes both arrays: its page parameters become decimal
strings at the JSON boundary and regain their Cursor prototype and methods during hydration.
A result Schema alone cannot choose this page-parameter representation.

Accumulated history preserves decoded `undefined` elements. Ordinary JSON would turn an
undefined array element into `null`, so `UndefinedElement` encodes it as a distinct tagged value.
A real `null` remains `null`. Live queries already normalize an entirely undefined emission to
`null`; their codec retains that value.

For an HTTP header wrapper, normalization applies to the whole emitted value. A wrapper whose
`body` is undefined remains a wrapper with an undefined body. `WrappedElement` preserves that
body with the same tagged encoding and reconstructs the wrapper with
`HttpApiSchema.withHeaders`. `WithHeaders` is an HTTP declaration; use explicit body/header
codecs at the JSON boundary so rich body values and decoded numeric headers regain their types.

`BufferedProfile` includes both declared HTTP successes. Adapt that union to your endpoint and
its status declarations. `ProfileMetadata` preserves decoded data, numeric status, and raw
string headers. Hydrated envelopes belong to the application and remain unfrozen. A subsequent
metadata fetch produces the library's frozen envelope and raw headers again; decoded data stays
mutable. Select public response headers before sending metadata that contains private values.

## Prepare the complete snapshot before continuing

After prefetching finite queries, run `prepareViewSnapshot(serverQueryClient)` through the
application's runner with `SnapshotEncoding` provided. Supply any asynchronous encoding work
through `beforeEncode`, then await the returned JSON before publishing it through your framework.
The original cache keeps decoded classes, bigint values, byte arrays, and page parameters.

For an open HTTP or RPC stream, first await
[fetchStreamSnapshot](/effect-api-query/guides/stream-snapshots/) with its exact generated stream
options. It captures the first visible value and awaits local iterator cleanup. Keep exclusive
ownership of that idle, unobserved key during capture. Only then prepare JSON and dispose the
server's ready-client resources. Local cleanup does not acknowledge remote cancellation.

On the browser, provide `SnapshotDecoding` and await `prepareViewHydration(browserQueryClient,
json)` before querying or mounting observers. Encoding and decoding require separate services;
one cannot satisfy the other. All selected data decodes before a single native `hydrate` call,
so invalid codec data or an unknown codec ID leaves the browser cache untouched.

The preparation helpers accept the matching trusted server's native dehydrated envelope and
validate selected query data. Validate arbitrary external snapshots separately. Handle
malformed JSON and preparation failures in the application's rendering or hydration error path.

Only successful queries in the reserved family enter the snapshot. Mutations and failed-query
errors/Causes are omitted. Hydration therefore leaves an omitted failed query available for a
new browser fetch. Error hydration needs its own application-safe representation.

Choose native freshness defaults to control duplicate reads. A successful fresh hydrated query
can reuse its reconstructed data; later invalidation and refetch use the browser's independent
ready client and the same decoded representation. For streams, explicit cached capture acquires
no new work; fresh capture starts the browser stream again. Keep Effects and Promises outside
query data and finish preparation before publishing or hydrating.
