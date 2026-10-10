import { MutationObserver, QueryClient } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { Deferred, Effect, Exit, Scope, Stream } from 'effect'
import { HttpServer } from 'effect/http'
import { HttpApiBuilder, HttpApiTest } from 'effect/http-api'
import { RpcTest } from 'effect/rpc'
import { deepStrictEqual, equal, ok, rejects } from 'node:assert/strict'

import { makeOwnerQueries, ownerApi, ownerGroup } from './docs-owner-cache.ts'
import { makeOwnerCache, ownerKeyPrefix } from './owner-cache.ts'

const identity = {
  tenantId: 'team-a',
  userId: 'user-a',
  sessionGeneration: 2,
  permissionGeneration: 4,
}
const values = new Map<string, string>()
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  removeItem: (key: string) => {
    values.delete(key)
  },
  setItem: (key: string, json: string) => {
    values.set(key, json)
  },
}
const wait = async (deferred: Deferred.Deferred<undefined>) =>
  await Effect.runPromise(Deferred.await(deferred).pipe(Effect.timeout('5 seconds')))
const waitForData = async (queryClient: QueryClient, key: QueryKey, expected: string) => {
  const published = Deferred.makeUnsafe<undefined>()
  const check = () => {
    if (queryClient.getQueryData(key) === expected) {
      Effect.runSync(Deferred.succeed(published, undefined))
    }
  }
  const unsubscribe = queryClient.getQueryCache().subscribe(check)
  try {
    check()
    await wait(published)
  } finally {
    unsubscribe()
  }
}

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const oldScope = yield* Scope.make()
      const newScope = yield* Scope.make()
      const mutationEntered = Deferred.makeUnsafe<undefined>()
      const releaseMutation = Deferred.makeUnsafe<undefined>()
      const callbackEntered = Deferred.makeUnsafe<undefined>()
      const releaseCallback = Deferred.makeUnsafe<undefined>()
      const finalized = Deferred.makeUnsafe<undefined>()
      const oldDirectory = [{ id: 1, name: 'Old private directory', locale: 'en' }]
      let newDirectory = [{ id: 10, name: 'New private directory', locale: 'fr' }]
      const makeClients = Effect.fnUntraced(function* (scope: Scope.Scope, isOld: boolean) {
        const directory = () => (isOld ? oldDirectory : newDirectory)
        const create = Effect.fnUntraced(function* ({ name }: { readonly name: string }) {
          if (isOld) {
            yield* Deferred.succeed(mutationEntered, undefined)
            yield* Deferred.await(releaseMutation)
          }
          const user = { id: isOld ? 2 : 11, name, locale: 'en' }
          if (isOld) {
            oldDirectory.push(user)
          } else {
            newDirectory = [...newDirectory, user]
          }
          return user
        })
        const rpcClient = yield* RpcTest.makeClient(ownerGroup, { flatten: true }).pipe(
          Effect.provide(
            ownerGroup.toLayer({
              'users.list': () => Effect.sync(directory),
              'users.get': ({ id }) =>
                Effect.succeed({ id, name: isOld ? 'Old user' : 'New user', locale: 'en' }),
              'users.create': create,
              'users.watch': () =>
                Stream.make('old first visible').pipe(
                  Stream.concat(Stream.fromEffect(Effect.never)),
                  Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
                ),
            }),
          ),
          Scope.provide(scope),
        )
        const httpClient = yield* HttpApiTest.groups(ownerApi, ['users']).pipe(
          Effect.provide(
            HttpApiBuilder.group(ownerApi, 'users', (handlers) =>
              handlers.handleAll({
                list: () => Effect.sync(directory),
                get: ({ params }) =>
                  Effect.succeed({
                    id: params.id,
                    name: isOld ? 'Old user' : 'New user',
                    locale: 'en',
                  }),
                create: ({ payload }) => create(payload),
              }),
            ),
          ),
          Scope.provide(scope),
        )
        return { rpcClient, httpClient }
      })
      const oldClients = yield* makeClients(oldScope, true)
      const previous = makeOwnerQueries({ ...oldClients, identity, storage })
      let current: ReturnType<typeof makeOwnerQueries> | undefined
      try {
        yield* Effect.promise(() =>
          previous.queryClient.query(previous.rpc.users.list.queryOptions()),
        )
        yield* Effect.promise(() =>
          previous.queryClient.query(previous.http.users.list.queryOptions()),
        )
        previous.owner.persistDirectory()
        equal(values.size, 1)
        const watchOptions = previous.rpc.users.watch.liveOptions()
        const watching = previous.queryClient.query(watchOptions).catch(() => null)
        yield* Effect.promise(() =>
          waitForData(previous.queryClient, watchOptions.queryKey, 'old first visible'),
        )
        const mutation = new MutationObserver(previous.queryClient, {
          ...previous.createUser,
          onSuccess: async (...args) => {
            await Effect.runPromise(Deferred.succeed(callbackEntered, undefined))
            await wait(releaseCallback)
            await previous.createUser.onSuccess?.(...args)
          },
        })
        const writing = mutation.mutate({ name: 'Completed remote write' })
        yield* Deferred.await(mutationEntered)
        previous.owner.persistDirectory()
        equal(values.size, 0)
        let retired = false
        const retirement = (async () => {
          await previous.owner.retire()
          retired = true
        })()
        equal(previous.owner.isActive(), false)
        yield* Effect.promise(() =>
          rejects(
            previous.owner.runMutation(async () => 1),
            /Owner is inactive/u,
          ),
        )
        yield* Effect.promise(async () => {
          await Promise.resolve()
        })
        equal(retired, false)
        equal(previous.queryClient.getQueryCache().getAll().length, 0)
        yield* Deferred.succeed(releaseMutation, undefined)
        yield* Deferred.await(callbackEntered)
        yield* Effect.promise(() => retirement)
        deepStrictEqual(
          oldDirectory.map((user) => user.name),
          ['Old private directory', 'Completed remote write'],
        )
        yield* Scope.close(oldScope, Exit.void)
        yield* Deferred.await(finalized)
        yield* Effect.promise(() => watching)
        equal(previous.queryClient.isFetching(), 0)
        const newIdentity = { ...identity, permissionGeneration: 5 }
        const newClients = yield* makeClients(newScope, false)
        current = makeOwnerQueries({ ...newClients, identity: newIdentity, storage })
        ok(current.queryClient !== previous.queryClient)
        for (const name of [
          'tenantId',
          'userId',
          'sessionGeneration',
          'permissionGeneration',
        ] as const) {
          const nextIdentity = {
            ...identity,
            [name]: typeof identity[name] === 'number' ? 99 : 'another',
          }
          ok(
            JSON.stringify(ownerKeyPrefix(nextIdentity)) !==
              JSON.stringify(ownerKeyPrefix(identity)),
          )
        }
        deepStrictEqual(
          yield* Effect.promise(() =>
            current!.queryClient.query(current!.rpc.users.list.queryOptions()),
          ),
          [{ id: 10, name: 'New private directory', locale: 'fr' }],
        )
        yield* Effect.promise(() =>
          current!.queryClient.query(current!.http.users.list.queryOptions()),
        )
        current.owner.persistDirectory()
        const newSnapshot = [...values.entries()]
        yield* Deferred.succeed(releaseCallback, undefined)
        yield* Effect.promise(() => writing)
        equal(previous.queryClient.getQueryCache().getAll().length, 0)
        equal(
          current.queryClient.getQueryState(current.rpc.users.list.queryKey())?.isInvalidated,
          false,
        )
        deepStrictEqual([...values.entries()], newSnapshot)
        const restored = makeOwnerQueries({ ...newClients, identity: newIdentity, storage })
        deepStrictEqual(
          restored.queryClient.getQueryData(restored.rpc.users.list.queryKey()),
          newDirectory,
        )
        deepStrictEqual(
          restored.queryClient.getQueryData(restored.http.users.list.queryKey()),
          newDirectory,
        )
        newDirectory = [{ id: 10, name: 'Fresh after restore', locale: 'fr' }]
        deepStrictEqual(
          yield* Effect.promise(() =>
            restored.queryClient.query(restored.rpc.users.list.queryOptions()),
          ),
          newDirectory,
        )
        deepStrictEqual(
          yield* Effect.promise(() =>
            restored.queryClient.query(restored.http.users.list.queryOptions()),
          ),
          newDirectory,
        )
        yield* Effect.promise(() => restored.owner.retire())
        equal(values.size, 0)
      } finally {
        yield* Deferred.succeed(releaseMutation, undefined)
        yield* Deferred.succeed(releaseCallback, undefined)
        yield* Effect.promise(() => previous.owner.retire())
        if (current !== undefined) {
          yield* Effect.promise(() => current!.owner.retire())
        }
        yield* Scope.close(oldScope, Exit.void)
        yield* Scope.close(newScope, Exit.void)
      }
    }),
  ).pipe(Effect.provide(HttpServer.layerServices)),
)

const directory = [{ id: 1, name: 'Safe DTO', locale: 'en' }]
const queryClient = new QueryClient()
const directoryKeys = {
  rpc: [...ownerKeyPrefix(identity), 'rpc', 'users', 'list', 'query'],
  http: [...ownerKeyPrefix(identity), 'http', 'users', 'list', 'query'],
}
const owner = makeOwnerCache({ identity, queryClient, directoryKeys, storage })
const storageKey = `effect-api-query:directory:${JSON.stringify(ownerKeyPrefix(identity))}`
const snapshot = {
  identity,
  schemaVersion: 1,
  keyVersion: 1,
  directories: [{ adapter: 'rpc', data: directory }],
}
for (const invalid of [
  { ...snapshot, identity: { ...identity, userId: 'another-user' } },
  { ...snapshot, identity: { ...identity, tenantId: 'another-team' } },
  { ...snapshot, identity: { ...identity, sessionGeneration: 3 } },
  { ...snapshot, identity: { ...identity, permissionGeneration: 5 } },
  { ...snapshot, schemaVersion: 2 },
  { ...snapshot, keyVersion: 2 },
  {
    ...snapshot,
    directories: [
      { adapter: 'rpc', data: directory },
      { adapter: 'http', data: [{ id: 'invalid' }] },
    ],
  },
]) {
  storage.setItem(storageKey, JSON.stringify(invalid))
  equal(owner.restoreDirectory(), false)
  equal(queryClient.getQueryCache().getAll().length, 0)
  equal(values.size, 0)
}
storage.setItem(storageKey, '{invalid json')
equal(owner.restoreDirectory(), false)
equal(values.size, 0)
storage.setItem(storageKey, JSON.stringify(snapshot))
equal(owner.restoreDirectory(), true)
deepStrictEqual(queryClient.getQueryData(directoryKeys.rpc), directory)
equal(queryClient.getQueryState(directoryKeys.rpc)?.dataUpdatedAt, 0)
await owner.retire()
owner.persistDirectory()
equal(owner.restoreDirectory(), false)
equal(values.size, 0)
equal(queryClient.getQueryCache().getAll().length, 0)
