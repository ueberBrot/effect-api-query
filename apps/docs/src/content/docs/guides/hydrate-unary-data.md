---
title: Hydrate Unary Data
description: Keep DTOs or rich Schema values consistent across JSON hydration and client refetch.
---

Choose a cache data shape before you add server rendering. Use the same contract, prefix, and inputs on both sides. Give server and browser separate QueryClients, Effect clients, and runtimes. Cancel outstanding queries before disposing of resources.

These examples transfer successful profile reads and omit mutations. For pages, stream data, and HTTP metadata, use [view codecs](/effect-api-query/guides/hydrate-query-views/).

## Keep DTOs in both caches

If components need plain data, return a JSON-safe data transfer object (DTO). This contract uses decimal strings for credits and base64 strings for binary data. The ready client returns the same shape on both sides.

Import `Schema` from `effect` and define the DTO in your shared contract.

```ts
const ProfileDto = Schema.Struct({
  name: Schema.String,
  credits: Schema.String,
  avatar: Schema.String.check(Schema.isBase64()),
});
```

The [complete DTO example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-hydration-dto.ts) includes both factories, `snapshotDto`, and `hydrateDto`.

Prefetch with `queryClient.query(dtoRpcOptions(rpcClient))` or its HTTP equivalent. Send `snapshotDto(queryClient)` through your framework. Call `hydrateDto` on the browser cache before its first query. The example keeps data fresh for 60 seconds to prevent an immediate duplicate read. Refetches keep the same DTO shape.

If your domain uses classes, convert them to DTOs in the operation or ready-client adapter. A hook's `select` changes its return value while the cache keeps the full response.

## Reconstruct Schema classes with paired codecs

If components need methods or rich values, keep decoded objects in the cache. This `Profile` encodes bigint credits as a decimal string and its `Uint8Array` avatar as base64. Decoding restores the instance and its `summary` method.

Define the rich success Schema in the contract.

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

Pair `serializeData: Schema.encodeUnknownSync(Profile)` on the server with `defaultOptions: { deserializeData: Schema.decodeUnknownSync(Profile) }` in the browser. See the [rich-value example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-hydration-rich.ts) for `snapshotProfile`, `hydrateProfile`, and both factories.

Prefetch with `profileRpcOptions` or `profileHttpOptions`. Send `snapshotProfile` and then call `hydrateProfile` in the browser. Both the hydrated value and later refetch contain a `Profile` with bigint credits and bytes. The example reserves the `'profile'` prefix for this shape. You can bind a codec to a leaf with `queryViewCodec(leaf, 'query', Profile)`. Use `hydrationCallbacks(codec)` for a service-free codec and filter for matching successful queries. For multiple shapes, [derive a registry from the contract](/effect-api-query/guides/hydrate-query-views/#derive-a-registry-from-the-contract).

Native serialization and deserialization callbacks must finish synchronously without required services. Handle a thrown codec error in your rendering or hydration code.

`structuredClone` preserves bigint and typed arrays in memory. It copies class properties without their prototype and methods. Use a paired codec to send those values as JSON and restore the same representation as a later fetch.

## Finish effectful preparation before publishing or hydrating

If a codec needs services or asynchronous work, prepare the whole snapshot before calling TanStack's synchronous APIs. The example adds an app service that runs before Profile encoding and decoding.

Use `PreparedProfile` and its services from the [asynchronous example](https://github.com/ueberBrot/effect-api-query/blob/main/tests/types/docs-hydration-async.ts). Its hydration function decodes all entries before changing the cache.

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

Provide `HydrationPreparation` through the app Context or ManagedRuntime. Await `prepareProfileSnapshot` before sending JSON. Await `prepareProfileHydration` before the browser reads the cache. A decoding failure leaves the destination cache untouched.

Keep the preparation runtime alive until the Effect completes, then dispose of it with your other resources.

Both caches keep decoded `Profile` values. Only the snapshot contains encoded data. Schema validates each profile. Use the matching app encoder for the snapshot and make sure query keys and metadata also survive JSON transport.

## Omit failed queries by default

Keep `defaultShouldDehydrateQuery` so the browser refetches omitted failures with its own client. A new failure includes the generated error and its Cause. The examples keep this filter when selecting the profile prefix.

To transfer a failure, encode and decode `state.error` and `state.fetchFailureReason` separately. Native data callbacks only transform data. Allowlist public tags and fields. Leave out private messages, defects, and transport details.

Restore the error behavior your UI needs. A plain DTO needs explicit reconstruction to pass a package error class guard.

See [handle failures](/effect-api-query/guides/handle-failures/) and [retry queries](/effect-api-query/guides/retry-queries/) for failures on each client. For router ownership and cleanup, see [TanStack Start](/effect-api-query/guides/tanstack-start/).
