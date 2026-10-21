---
title: Hydrate Unary Data
description: Keep DTOs or rich Schema values consistent across JSON hydration and client refetch.
---

Before connecting server rendering to TanStack Query, choose the cache representation. The server and browser must use the same contract, key prefix, and inputs. Each owns a Query Client, ready Effect client, and runtime. Before disposing a runtime, cancel outstanding queries.

The recipes cover unary profile reads through either factory. They keep only successful profile queries and omit mutations. Use the [query-view recipe](/effect-api-query/guides/hydrate-query-views/) for infinite pages, stream snapshots, and HTTP metadata.

## Keep DTOs in both caches

Use a JSON-safe success schema when components need plain data. The contract below keeps credits as decimal strings and binary data as base64 strings. Return this DTO from the server operation. The ready RPC or HTTP client produces the same DTO on the server and browser.

In the shared contract module, import `Schema` from `effect` and declare the DTO:

```ts
const ProfileDto = Schema.Struct({
  name: Schema.String,
  credits: Schema.String,
  avatar: Schema.String.check(Schema.isBase64()),
});
```

The [complete DTO recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-hydration-dto.ts) connects this schema to both factories and provides `snapshotDto` and `hydrateDto`.

Prefetch with `queryClient.query(dtoRpcOptions(rpcClient))` or the HTTP equivalent. Publish `snapshotDto(queryClient)` through your framework's JSON transport. Before the browser's first query, call `hydrateDto` on its Query Client. The 60-second freshness window avoids an immediate duplicate read. Later invalidation and refetch still produce DTOs.

If your domain layer uses classes, convert them to this DTO in the operation or ready-client adapter on both sides. TanStack's `select` changes an observer's result. It does not change cached query data.

## Reconstruct Schema classes with paired codecs

Keep decoded domain objects in the cache when components need methods or rich values. Encode at the snapshot boundary and decode during hydration. This `Profile` encodes bigint credits as a string and its `Uint8Array` avatar as base64. Decoding reconstructs the class and its `summary` method.

In the shared contract module, define the rich success schema:

```ts
export class Profile extends Schema.Class<
  Profile,
  { readonly brand: unique symbol }
>("Profile")({
  name: Schema.String,
  credits: Schema.BigIntFromString,
  avatar: Schema.Uint8ArrayFromBase64,
}) {
  summary(): string {
    return `${this.name}: ${this.credits} credits`;
  }
}
```

In the server snapshot and browser hydration modules, pair `serializeData: Schema.encodeUnknownSync(Profile)` with `defaultOptions: { deserializeData: Schema.decodeUnknownSync(Profile) }`. The [complete rich-value recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-hydration-rich.ts) provides `snapshotProfile`, `hydrateProfile`, and options for both factories.

Prefetch with `profileRpcOptions` or `profileHttpOptions`. Publish `snapshotProfile`, then call `hydrateProfile` on the browser's Query Client. The hydrated value and a later browser refetch both have the `Profile` prototype, bigint credits, and byte array. Only the snapshot contains encoded strings. This recipe reserves the `'profile'` prefix for unary `Profile` data. Other query shapes need their own codec selection. To bind that selection to a generated leaf and view, use `queryViewCodec(leaf, 'query', Profile)` and `hydrationCallbacks(codec)`. The callbacks provide the same native `serializeData` and `deserializeData` functions for a service-free codec. Filter dehydration with `codec.matches(query.queryKey)` and the native success predicate. For multiple representations, use [a typed registry](/effect-api-query/guides/hydrate-query-views/#register-generated-leaves-and-views).

`serializeData` and `deserializeData` are synchronous callbacks. The synchronous Schema functions must finish without asynchronous work or required services. A codec failure throws. Handle the failure through your rendering or hydration error path.

`structuredClone` copies class properties without restoring the class prototype or methods. It preserves bigint and typed arrays in memory, but JSON still requires an encoding for those values. It does not provide a paired JSON codec. If you only clone the server class, hydration and a later class-valued refetch use different representations.

## Finish effectful preparation before publishing or hydrating

If a codec needs services or asynchronous work, prepare the entire snapshot outside TanStack's synchronous callbacks. This example adds a caller-owned preparation service to the same Profile codec. Its hooks can await application work before encoding or decoding.

The application's hydration module decodes all entries before changing the cache. Use `PreparedProfile` and its services from the [complete asynchronous recipe](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-hydration-async.ts) to define that boundary:

```ts
const prepareProfileHydration = Effect.fnUntraced(function* (
  queryClient: QueryClient,
  json: string
) {
  const snapshot: DehydratedState = JSON.parse(json);
  const queries = yield* Effect.forEach(snapshot.queries, (query) =>
    Schema.decodeUnknownEffect(PreparedProfile)(query.state.data).pipe(
      Effect.map((data) => ({ ...query, state: { ...query.state, data } }))
    )
  );
  yield* Effect.sync(() => hydrate(queryClient, { ...snapshot, queries }));
});
```

Provide `HydrationPreparation` through your application Context or ManagedRuntime. Await the result of `prepareProfileSnapshot` before publishing its JSON. On the browser, await `prepareProfileHydration` before queries or components read the hydrated cache. The hydration function decodes every entry before calling `hydrate`. If decoding fails, the destination cache stays untouched.

Keep the preparation runtime alive until the Effect completes. Dispose it through the application's lifecycle.

Neither preparation function puts an Effect or Promise into query data. The server cache keeps `Profile` values. The published snapshot contains encoded data, and the browser cache receives fully decoded `Profile` values. The Schema codec validates each profile. The surrounding snapshot must come from the matching application encoder. Query keys and metadata must also satisfy your JSON transport.

## Omit failed queries by default

Retain `defaultShouldDehydrateQuery` so failed queries stay out of the snapshot. The browser can refetch them with its own client and receive a fresh `EffectRpcQueryError` or `EffectHttpApiQueryError` and Cause. The recipes above preserve this policy even when selecting a profile prefix.

If you deliberately transfer failed queries, define a safe application error representation. Encode and decode both `state.error` and `state.fetchFailureReason`. `serializeData` and `deserializeData` transform query data without transforming those error fields. Allowlist public failure tags and fields. Omit private messages, defects, and transport details. Reconstruct the error behavior your UI requires.

JSON serialization of an Error or Cause does not supply that policy. A safe error DTO does not automatically become either package error class or pass its type guard.

For normal retry and error handling, keep failures local to each client and follow [Handle Failures](/effect-api-query/guides/handle-failures/) and [Retry Queries](/effect-api-query/guides/retry-queries/). For router ownership and cleanup, see [TanStack Start](/effect-api-query/guides/tanstack-start/).
