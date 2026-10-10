---
title: Switch Cache Owners
description: Isolate private queries, pending writes, and persisted directory data when an owner changes.
---

Include every safe identity that changes a result in the key prefix: tenant, user, session
generation, and permission generation. Use application identifiers and numeric generations;
bearer credentials never belong in keys or storage names. A permission change needs a new generation
even when the user and tenant stay the same. These values partition caches; the server still
owns authorization.

## Capture one owner

Copy [the existing Vite application's owner cache](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/owner-cache.ts)
into `owner-cache.ts`. The following focused recipe accepts already acquired clients and captures
one QueryClient, identity, and set of generated utilities. Keep their owning Scopes and runtimes
alive until this owner's work finishes.

```ts
import { QueryClient } from '@tanstack/react-query'
import { Effect, Schema } from 'effect'
import { createHttpApiQueryUtils, createRpcQueryUtils } from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import type { HttpApiClient } from 'effect/http-api'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'

import { makeOwnerCache, ownerKeyPrefix } from './owner-cache.ts'
import type { ApplicationOwnerIdentity, DirectoryStorage } from './owner-cache.ts'

export const DirectoryUser = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  locale: Schema.String,
})

export const ownerGroup = RpcGroup.make(
  Rpc.make('users.list', { success: Schema.Array(DirectoryUser) }),
  Rpc.make('users.get', { payload: { id: Schema.Int }, success: DirectoryUser }),
  Rpc.make('users.create', {
    payload: { name: Schema.String },
    success: DirectoryUser,
  }),
  Rpc.make('users.watch', { success: Schema.String, stream: true }),
)

export const ownerApi = HttpApi.make('owner-directory').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('list', '/users', { success: Schema.Array(DirectoryUser) }),
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      success: DirectoryUser,
    }),
    HttpApiEndpoint.post('create', '/users', {
      payload: Schema.Struct({ name: Schema.String }),
      success: DirectoryUser,
    }),
  ),
)

export const makeOwnerQueries = <RpcError>({
  rpcClient,
  httpClient,
  identity,
  storage,
  runPromiseExit = Effect.runPromiseExit,
}: {
  readonly rpcClient: RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof ownerGroup>, RpcError>
  readonly httpClient: HttpApiClient.ForApi<typeof ownerApi>
  readonly identity: ApplicationOwnerIdentity
  readonly storage?: DirectoryStorage
  readonly runPromiseExit?: RunPromiseExit
}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, networkMode: 'always' },
    },
  })
  const keyPrefix = ownerKeyPrefix(identity)
  const rpc = createRpcQueryUtils<typeof ownerGroup, typeof keyPrefix, RpcError>(ownerGroup, {
    client: rpcClient,
    keyPrefix,
    runPromiseExit,
  })
  const http = createHttpApiQueryUtils(ownerApi, { client: httpClient, keyPrefix, runPromiseExit })
  const owner = makeOwnerCache({
    identity,
    queryClient,
    directoryKeys: { rpc: rpc.users.list.queryKey(), http: http.users.list.queryKey() },
    storage,
  })
  owner.restoreDirectory()
  const invalidateUsers = async () => {
    if (!owner.isActive()) {
      return
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: rpc.users.key() }),
      queryClient.invalidateQueries({ queryKey: http.users.key() }),
    ])
  }
  const createUser = owner.trackMutationOptions(
    rpc.users.create.mutationOptions({
      onSuccess: async (user) => {
        if (!owner.isActive()) {
          return
        }
        queryClient.setQueryData(rpc.users.get.queryKey({ id: user.id }), user)
        await invalidateUsers()
      },
      onSettled: invalidateUsers,
    }),
  )
  return { owner, queryClient, rpc, http, createUser, invalidateUsers }
}
```

The success callback captures its original owner. It checks that owner before seeding a concrete
query, and settlement invalidation uses the same guard. An old callback never looks up a current
application variable to choose where to write. Apply the guard to rollback, optimistic writes,
manual cache updates, and any later work after an `await` too.

## Replace the consumer boundary

The [existing Vite application](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/lib/application.ts)
provides `startViteReactApplication(options)`. Capture `previous`, unmount its consumer tree,
and await `previous.dispose()` before starting and rendering the replacement application. This
retires the old owner before constructing the new clients, QueryClient, and utilities. A failed acquisition leaves the
old owner inactive; handle that failure in the surrounding application. Use the same unmount,
retire, and replacement sequence when reconnecting clients with an unchanged semantic identity.

[ViteReactExample](https://github.com/ueberBrot/effect-api-query/blob/main/examples/vite-react/src/app.tsx)
keys its QueryClientProvider by a component key that changes with the application QueryClient.
Replacing that client therefore remounts query and mutation consumers, including when the safe
semantic identity stays the same. This component key is not part of query keys or persistence. Passing a new QueryClient through an existing
provider alone does not replace the QueryClient captured by existing hooks. Reassigning options
on a pending MutationObserver can also replace its callbacks. Capture originating ownership in
mutation context and replace observers at the handoff; arbitrary observer reassignment is outside
this recipe.

Retirement immediately marks the captured owner inactive and removes its persisted snapshot.
It cancels old queries and streams, clears both native caches, and waits for accepted mutation
requests to settle. The application then releases its HTTP runtime and RPC client Scope. Complete
local stream cleanup before acquiring the next owner. Native `cancelQueries()` settlement alone
is not a finalizer acknowledgement, and local disposal is not a remote server acknowledgement.

The example attempts mutations immediately with `networkMode: 'always'` and `retry: false`.
It does not keep an offline mutation queue. `runMutation` tracks requests that have started;
new requests are rejected after retirement. Requests already accepted may complete on the server,
and switching owners does not undo them. Their `onSuccess` or `onSettled` callbacks may finish
after the request drain, so the ownership guard remains necessary. A hanging request or local
finalizer can delay the handoff; this policy supplies no completion deadline. Do not introduce
serialized mutation queues without an explicit ownership and shutdown policy.

## Restore a directory snapshot

Pass application-approved Storage to the Vite application through `directoryStorage`. The browser
entry uses sessionStorage. `persistDirectory()` writes only the RPC and HTTP `users.list` DTOs:
arrays of `{ id: number, name: string, locale: string }`. It stores no mutations, errors, arbitrary
query keys, classes, streams, infinite pages, or bearer credentials. A pending mutation removes
the stored snapshot so an optimistic directory cannot be reused after reload.

Storage names include the full safe owner tuple. Each envelope repeats that identity and includes
`schemaVersion: 1` and `keyVersion: 1`. Restoration validates the complete envelope and all DTO
entries, checks both busters and all owner fields, then writes through keys derived by the current
utilities. Foreign or incompatible data is deleted before any cache write. A different owner's
storage slot is never read. Bump the schema buster when DTO meaning changes and the key buster
when the persisted view's key contract changes.

Restored DTOs are plain data with `dataUpdatedAt: 0`, so ordinary queries refetch them. Class
constructors and methods are not restored by this recipe; use a paired codec from
[Hydrate Unary Data](/effect-api-query/guides/hydrate-unary-data/) when the domain requires them.

Default `dispose()` and owner switches erase persistence. The browser's pagehide cleanup explicitly
uses `dispose({ discardPersistence: false })` to snapshot a settled directory for a reload while
retiring the old in-memory owner and releasing its clients. Old-owner persistence calls become
no-ops. Storage failures propagate while query, cache, and client cleanup still run.
