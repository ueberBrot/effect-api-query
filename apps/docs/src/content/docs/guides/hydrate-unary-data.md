---
title: Hydrate Unary Data
description: Keep DTOs or rich Schema values consistent across JSON hydration and client refetch.
---

Choose the cache representation before connecting server rendering to TanStack Query. The server
and browser must use the same contract, key prefix, and inputs. Each owns its Query Client, ready
Effect client, and runtime. Cancel outstanding queries before disposing a runtime.

These recipes cover unary profile reads through either factory. They keep only successful profile
queries and omit mutations. Use the [query-view recipe](/effect-api-query/guides/hydrate-query-views/)
for infinite pages, stream snapshots, and HTTP metadata.

## Keep DTOs in both caches

Use a JSON-safe success schema when components need plain data. The contract below keeps credits
as decimal strings and binary data as base64 strings. Return this DTO from the server operation;
the ready RPC or HTTP client produces the same DTO on the server and browser.

Save the following as `docs-hydration-dto.ts`:

```ts
import { defaultShouldDehydrateQuery, dehydrate, hydrate } from '@tanstack/query-core'
import type { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils } from 'effect-api-query'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Rpc, RpcClient, RpcGroup } from 'effect/rpc'

const ProfileDto = Schema.Struct({
  name: Schema.String,
  credits: Schema.String,
  avatar: Schema.String.check(Schema.isBase64()),
})

const dtoGroup = RpcGroup.make(Rpc.make('profile.read', { success: ProfileDto }))
const dtoApi = HttpApi.make('dto').add(
  HttpApiGroup.make('profile').add(
    HttpApiEndpoint.get('read', '/profile', { success: ProfileDto }),
  ),
)

function dtoRpcOptions<E>(client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof dtoGroup>, E>) {
  return createRpcQueryUtils<typeof dtoGroup, readonly ['dto', 'rpc'], E>(dtoGroup, {
    client,
    keyPrefix: ['dto', 'rpc'],
  }).profile.read.queryOptions({ retry: false, staleTime: 60_000 })
}

function dtoHttpOptions(client: HttpApiClient.ForApi<typeof dtoApi>) {
  return createHttpApiQueryUtils(dtoApi, {
    client,
    keyPrefix: ['dto', 'http'],
  }).profile.read.queryOptions({ retry: false, staleTime: 60_000 })
}

const snapshotDto = (queryClient: QueryClient): string =>
  JSON.stringify(
    dehydrate(queryClient, {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query) =>
        defaultShouldDehydrateQuery(query) && query.queryKey[0] === 'dto',
    }),
  )

const hydrateDto = (queryClient: QueryClient, json: string): void =>
  hydrate(queryClient, JSON.parse(json))
```

Prefetch with `queryClient.query(dtoRpcOptions(rpcClient))` or the HTTP equivalent, then publish
`snapshotDto(queryClient)` through your framework's JSON transport. Call `hydrateDto` on the
browser's Query Client before its first query. The 60-second freshness window avoids an immediate
duplicate read; subsequent invalidation and refetch still produce DTOs.

If your domain layer uses classes, convert them to this DTO in the operation or ready-client
adapter on both sides. TanStack's `select` changes an observer's result; it does not change cached
query data.

## Reconstruct Schema classes with paired codecs

Keep decoded domain objects in the cache when components need methods or rich values. Encode at
the snapshot boundary and decode during hydration. This `Profile` encodes bigint credits as a
string and its `Uint8Array` avatar as base64. Decoding reconstructs the class and its `summary`
method.

Save the following as `docs-hydration-rich.ts`:

```ts
import { defaultShouldDehydrateQuery, dehydrate, hydrate } from '@tanstack/query-core'
import type { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils } from 'effect-api-query'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Rpc, RpcClient, RpcGroup } from 'effect/rpc'

export class Profile extends Schema.Class<Profile>('Profile')({
  name: Schema.String,
  credits: Schema.BigIntFromString,
  avatar: Schema.Uint8ArrayFromBase64,
}) {
  summary(): string {
    return `${this.name}: ${this.credits} credits`
  }
}

const profileGroup = RpcGroup.make(
  Rpc.make('profile.read', { success: Profile, error: Schema.String }),
)
const profileApi = HttpApi.make('rich').add(
  HttpApiGroup.make('profile').add(
    HttpApiEndpoint.get('read', '/profile', { success: Profile, error: Schema.String }),
  ),
)

function profileRpcOptions<E>(
  client: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof profileGroup>, E>,
) {
  return createRpcQueryUtils<typeof profileGroup, readonly ['profile', 'rpc'], E>(profileGroup, {
    client,
    keyPrefix: ['profile', 'rpc'],
  }).profile.read.queryOptions({ retry: false, staleTime: 60_000 })
}

function profileHttpOptions(client: HttpApiClient.ForApi<typeof profileApi>) {
  return createHttpApiQueryUtils(profileApi, {
    client,
    keyPrefix: ['profile', 'http'],
  }).profile.read.queryOptions({ retry: false, staleTime: 60_000 })
}

const snapshotProfile = (queryClient: QueryClient): string =>
  JSON.stringify(
    dehydrate(queryClient, {
      shouldDehydrateMutation: () => false,
      shouldDehydrateQuery: (query) =>
        defaultShouldDehydrateQuery(query) && query.queryKey[0] === 'profile',
      serializeData: Schema.encodeUnknownSync(Profile),
    }),
  )

const hydrateProfile = (queryClient: QueryClient, json: string): void =>
  hydrate(queryClient, JSON.parse(json), {
    defaultOptions: { deserializeData: Schema.decodeUnknownSync(Profile) },
  })
```

Prefetch with `profileRpcOptions` or `profileHttpOptions`, publish `snapshotProfile`, then call
`hydrateProfile` on the browser's Query Client. The hydrated value and a later browser refetch
both have the `Profile` prototype, bigint credits, and byte array. Only the snapshot contains the
encoded strings. The `'profile'` prefix in this recipe is reserved for unary `Profile` data;
other query shapes need their own codec selection.

`serializeData` and `deserializeData` are synchronous callbacks. The synchronous Schema functions
must be able to finish without asynchronous work or required services. A codec failure throws;
handle it through your rendering or hydration error path.

`structuredClone` is not a paired JSON codec. It copies class properties without restoring the
class prototype or methods. It preserves bigint and typed arrays in memory, but JSON still
requires an encoding for those values. Cloning a server class alone also leaves hydration and a
later class-valued refetch with different representations.

## Finish effectful preparation before publishing or hydrating

When a codec needs services or asynchronous work, prepare the entire snapshot outside TanStack's
synchronous callbacks. This example adds a caller-owned preparation service to the same Profile
codec. Its hooks can await application work before encoding or decoding.

Save the following alongside `docs-hydration-rich.ts`:

```ts
import { defaultShouldDehydrateQuery, dehydrate, hydrate } from '@tanstack/query-core'
import type { DehydratedState, QueryClient } from '@tanstack/query-core'
import { Context, Effect, Schema } from 'effect'

import { Profile } from './docs-hydration-rich.ts'

class HydrationPreparation extends Context.Service<
  HydrationPreparation,
  {
    readonly beforeEncode: Effect.Effect<void>
    readonly beforeDecode: Effect.Effect<void>
  }
>()('HydrationPreparation') {}

const PreparedProfile = Profile.pipe(
  Schema.middlewareEncoding<typeof Profile, HydrationPreparation>((encoding) =>
    Effect.flatMap(HydrationPreparation, ({ beforeEncode }) =>
      Effect.andThen(beforeEncode, encoding),
    ),
  ),
  Schema.middlewareDecoding((decoding) =>
    Effect.flatMap(HydrationPreparation, ({ beforeDecode }) =>
      Effect.andThen(beforeDecode, decoding),
    ),
  ),
)

const prepareProfileSnapshot = Effect.fnUntraced(function* (queryClient: QueryClient) {
  const snapshot = dehydrate(queryClient, {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) && query.queryKey[0] === 'profile',
  })
  const queries = yield* Effect.forEach(snapshot.queries, (query) =>
    Schema.encodeUnknownEffect(PreparedProfile)(query.state.data).pipe(
      Effect.map((data) => ({ ...query, state: { ...query.state, data } })),
    ),
  )
  return JSON.stringify({ ...snapshot, queries })
})

const prepareProfileHydration = Effect.fnUntraced(function* (
  queryClient: QueryClient,
  json: string,
) {
  const snapshot: DehydratedState = JSON.parse(json)
  const queries = yield* Effect.forEach(snapshot.queries, (query) =>
    Schema.decodeUnknownEffect(PreparedProfile)(query.state.data).pipe(
      Effect.map((data) => ({ ...query, state: { ...query.state, data } })),
    ),
  )
  yield* Effect.sync(() => hydrate(queryClient, { ...snapshot, queries }))
})
```

Provide `HydrationPreparation` through your application Context or ManagedRuntime. Await the
result of `prepareProfileSnapshot` before publishing its JSON. On the browser, await
`prepareProfileHydration` before allowing queries or components to read the hydrated cache. The
latter decodes every entry before calling `hydrate`, so decoding failure leaves the destination
cache untouched. Keep the preparation runtime alive until the Effect completes, and dispose it
through the application's lifecycle.

Neither preparation function puts an Effect or Promise into query data. The server cache keeps
`Profile` values, the published snapshot contains encoded data, and the browser cache receives
fully decoded `Profile` values. The Schema codec validates each profile; the surrounding snapshot
must come from the matching application encoder. Query keys and metadata must also satisfy your
JSON transport.

## Omit failed queries by default

Retain `defaultShouldDehydrateQuery` so failed queries stay out of the snapshot. The browser can
refetch them with its own client and receive a fresh `EffectRpcQueryError` or
`EffectHttpApiQueryError` and Cause. The recipes above preserve this policy even when selecting a
profile prefix.

If you deliberately transfer failed queries, define a safe application error representation.
Encode and decode both `state.error` and `state.fetchFailureReason`; `serializeData` and
`deserializeData` transform query data, not those error fields. Allowlist public failure tags and
fields, omit private messages, defects, and transport details, and reconstruct the error behavior
your UI requires. JSON serialization of an Error or Cause does not supply that policy. A safe
error DTO will not automatically become either package error class or pass its type guard.

For normal retry and error handling, keep failures local to each client and follow
[Handle Failures](/effect-api-query/guides/handle-failures/) and
[Retry Queries](/effect-api-query/guides/retry-queries/). For router ownership and cleanup, see
[TanStack Start](/effect-api-query/guides/tanstack-start/).
