import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core'
import { Effect, Exit, Option, Scope, Stream } from 'effect'
import { Reactivity } from 'effect/reactivity'
import { deepStrictEqual, equal } from 'node:assert/strict'

import { User, UserPage } from '../../examples/contracts/src/contracts.ts'
import { makeControlledUserWrites } from '../fixtures/optimistic-users.ts'
import { attachUserEvents } from './docs-user-events.ts'
import { decodeUserEvent, makeUserEventConsumer } from './user-events.ts'

const queryClient = new QueryClient({
  defaultOptions: { queries: { queryKeyHashFn: (key) => `owner:${JSON.stringify(key)}` } },
})
const fixture = await Effect.runPromise(makeControlledUserWrites(queryClient))
const { rpcQuery, httpQuery } = fixture.application
queryClient.setQueryDefaults(rpcQuery.users.key(), {
  queryKeyHashFn: (key) => `rpc:${JSON.stringify(key)}`,
})
queryClient.setQueryDefaults(httpQuery.users.key(), {
  queryKeyHashFn: (key) => `http:${JSON.stringify(key)}`,
})
const scope = Effect.runSync(Scope.make())
const reactivity = Effect.runSync(Reactivity.make)
const ada = new User({ id: 1, name: 'Ada', locale: 'en' })
const alan = new User({ id: 2, name: 'Alan', locale: 'en' })
const rpcDirectory = rpcQuery.users.list.queryKey()
const httpDirectory = httpQuery.users.list.queryKey()
const rpcAda = rpcQuery.users.get.queryKey({ id: 1, locale: 'en' })
const httpAda = httpQuery.users.get.queryKey({ params: { id: 1 }, query: { locale: 'en' } })
const rpcAlan = rpcQuery.users.get.queryKey({ id: 2, locale: 'en' })
const diagnostic = rpcQuery.diagnostics.status.queryKey()
queryClient.setQueryData(rpcDirectory, [ada, alan])
queryClient.setQueryData(httpDirectory, [ada, alan])
queryClient.setQueryData(rpcAda, ada)
queryClient.setQueryData(httpAda, ada)
queryClient.setQueryData(rpcAlan, alan)
queryClient.setQueryData(diagnostic, { started: 0, interrupted: 0 })
try {
  const consumer = await Effect.runPromise(
    makeUserEventConsumer(fixture.application, reactivity, {
      observedUsers: [{ id: 1, locale: 'en' }],
    }).pipe(Scope.provide(scope)),
  )
  equal(
    await Effect.runPromise(
      consumer.deliver({
        schema: 'users.v1',
        ownerKey: consumer.ownerKey,
        cursor: 1,
        kind: 'user.changed',
        id: 1,
        locale: 'en',
      }),
    ),
    true,
  )
  await consumer.flush()
  equal(queryClient.getQueryState(rpcDirectory)?.isInvalidated, true)
  equal(queryClient.getQueryState(httpDirectory)?.isInvalidated, true)
  equal(queryClient.getQueryState(rpcAda)?.isInvalidated, true)
  equal(queryClient.getQueryState(httpAda)?.isInvalidated, true)
  equal(queryClient.getQueryState(rpcAlan)?.isInvalidated, false)
  equal(queryClient.getQueryState(diagnostic)?.isInvalidated, false)
  queryClient.setQueryData(rpcAda, ada)
  queryClient.setQueryData(httpAda, ada)
  reactivity.invalidateUnsafe([consumer.reactivityKeys.user({ id: 1, locale: 'en' })])
  await consumer.flush()
  equal(queryClient.getQueryState(rpcAda)?.isInvalidated, true)
  equal(queryClient.getQueryState(httpAda)?.isInvalidated, true)
  equal(queryClient.getQueryState(rpcAlan)?.isInvalidated, false)
  fixture.holdLists()
  const rpcObserver = new QueryObserver(
    queryClient,
    rpcQuery.users.list.queryOptions({
      staleTime: Infinity,
    }),
  )
  const httpObserver = new QueryObserver(
    queryClient,
    httpQuery.users.list.queryOptions({
      staleTime: Infinity,
    }),
  )
  queryClient.setQueryData(rpcDirectory, [ada, alan])
  queryClient.setQueryData(httpDirectory, [ada, alan])
  const unsubscribeRpc = rpcObserver.subscribe(() => {})
  const unsubscribeHttp = httpObserver.subscribe(() => {})
  try {
    await Effect.runPromise(
      reactivity.withBatch(
        Effect.gen(function* () {
          yield* reactivity.invalidate([consumer.reactivityKeys.directory])
          yield* reactivity.invalidate([consumer.reactivityKeys.directory])
          yield* reactivity.invalidate([consumer.reactivityKeys.all])
        }),
      ),
    )
    const first = await fixture.nextList()
    const second = await fixture.nextList()
    const grace = new User({ id: 3, name: 'Grace', locale: 'fr' })
    await first.succeed([grace])
    await second.succeed([grace])
    await consumer.flush()
    deepStrictEqual(
      queryClient.getQueryData(rpcDirectory)?.map((user) => user.name),
      ['Grace'],
    )
    deepStrictEqual(
      queryClient.getQueryData(httpDirectory)?.map((user) => user.name),
      ['Grace'],
    )
    equal(queryClient.getQueryState(diagnostic)?.isInvalidated, false)
  } finally {
    unsubscribeRpc()
    unsubscribeHttp()
  }
  queryClient.setQueryData(rpcAda, ada)
  queryClient.setQueryData(httpAda, ada)
  equal(
    await Effect.runPromise(
      consumer.deliver({
        schema: 'users.v1',
        ownerKey: consumer.ownerKey,
        cursor: 1,
        kind: 'user.changed',
        id: 1,
        locale: 'en',
      }),
    ),
    false,
  )
  await consumer.flush()
  equal(queryClient.getQueryState(rpcAda)?.isInvalidated, false)
  equal(await Effect.runPromise(consumer.resume(true)), 1)
  equal(
    await Effect.runPromise(
      consumer.deliver({
        schema: 'users.v1',
        ownerKey: consumer.ownerKey,
        cursor: 3,
        kind: 'user.changed',
        id: 1,
        locale: 'en',
      }),
    ),
    true,
  )
  await consumer.flush()
  equal(queryClient.getQueryState(rpcAlan)?.isInvalidated, true)
  equal(queryClient.getQueryState(diagnostic)?.isInvalidated, false)
  queryClient.setQueryData(rpcAlan, alan)
  equal(await Effect.runPromise(consumer.resume(false)), 0)
  await consumer.flush()
  equal(queryClient.getQueryState(rpcAlan)?.isInvalidated, true)
  equal(consumer.cursor(), 0)
  queryClient.setQueryData(rpcAda, ada)
  const rpcPages = rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 })
  const httpPages = httpQuery.users.page.infiniteKey({ query: { cursor: 0, pageSize: 4 } })
  const pages = {
    pages: [new UserPage({ users: [ada], total: 1, nextCursor: null })],
    pageParams: [0],
  }
  queryClient.setQueryData(rpcPages, pages)
  queryClient.setQueryData(httpPages, pages)
  equal(
    await Effect.runPromise(
      consumer.deliver({
        schema: 'users.v1',
        ownerKey: consumer.ownerKey,
        cursor: 1,
        kind: 'users.changed',
      }),
    ),
    true,
  )
  await consumer.flush()
  equal(queryClient.getQueryState(rpcPages)?.isInvalidated, true)
  equal(queryClient.getQueryState(httpPages)?.isInvalidated, true)
  equal(queryClient.getQueryState(rpcAda)?.isInvalidated, false)
  equal(
    await Effect.runPromise(
      consumer.deliver({
        schema: 'users.v1',
        ownerKey: consumer.ownerKey,
        cursor: 2,
        kind: 'users.reset',
      }),
    ),
    true,
  )
  await consumer.flush()
  equal(queryClient.getQueryState(rpcAda)?.isInvalidated, true)
  const malformed = await Effect.runPromiseExit(
    decodeUserEvent({
      schema: 'users.v2',
      ownerKey: consumer.ownerKey,
      cursor: 1,
      kind: 'user.changed',
      id: 1,
      locale: 'en',
    }).pipe(Effect.flatMap(consumer.deliver)),
  )
  equal(Exit.isFailure(malformed), true)
  equal(consumer.cursor(), 2)
  equal(
    await Effect.runPromise(
      consumer.deliver({
        schema: 'users.v1',
        ownerKey: 'other-owner',
        cursor: 3,
        kind: 'user.changed',
        id: 1,
        locale: 'en',
      }),
    ),
    false,
  )
  equal(consumer.cursor(), 2)
  const duplicateScope = Effect.runSync(Scope.make())
  try {
    const duplicate = await Effect.runPromiseExit(
      makeUserEventConsumer(fixture.application, reactivity).pipe(Scope.provide(duplicateScope)),
    )
    equal(Exit.isFailure(duplicate), true)
  } finally {
    await Effect.runPromise(Scope.close(duplicateScope, Exit.void))
  }
  queryClient.setQueryData(rpcAda, ada)
  await Effect.runPromise(Scope.close(scope, Exit.void))
  reactivity.invalidateUnsafe([consumer.reactivityKeys.all])
  equal(
    await Effect.runPromise(
      consumer.deliver({
        schema: 'users.v1',
        ownerKey: consumer.ownerKey,
        cursor: 1,
        kind: 'user.changed',
        id: 1,
        locale: 'en',
      }),
    ),
    false,
  )
  await consumer.flush()
  equal(queryClient.getQueryState(rpcAda)?.isInvalidated, false)
  const reconnectScope = Effect.runSync(Scope.make())
  try {
    const reconnect = await Effect.runPromise(
      makeUserEventConsumer(fixture.application, reactivity).pipe(Scope.provide(reconnectScope)),
    )
    reactivity.invalidateUnsafe([reconnect.reactivityKeys.all])
    const queuedDelivery = Promise.resolve().then(async () =>
      Effect.runPromise(
        reconnect.deliver({
          schema: 'users.v1',
          ownerKey: reconnect.ownerKey,
          cursor: 1,
          kind: 'user.changed',
          id: 1,
          locale: 'en',
        }),
      ),
    )
    fixture.retire()
    equal(await queuedDelivery, false)
    await reconnect.flush()
    await fixture.application.dispose()
    equal(queryClient.getQueryData(rpcAda), undefined)
    equal(
      await Effect.runPromise(
        reconnect.deliver({
          schema: 'users.v1',
          ownerKey: reconnect.ownerKey,
          cursor: 1,
          kind: 'user.changed',
          id: 1,
          locale: 'en',
        }),
      ),
      false,
    )
    const replacementClient = new QueryClient()
    const replacement = await Effect.runPromise(makeControlledUserWrites(replacementClient))
    try {
      const key = replacement.application.rpcQuery.users.get.queryKey({ id: 1, locale: 'en' })
      const newOwnerUser = new User({ id: 1, locale: 'en', name: 'New owner' })
      replacementClient.setQueryData(key, newOwnerUser)
      equal(
        await Effect.runPromise(
          reconnect.deliver({
            schema: 'users.v1',
            ownerKey: reconnect.ownerKey,
            cursor: 2,
            kind: 'users.reset',
          }),
        ),
        false,
      )
      await reconnect.flush()
      equal(replacementClient.getQueryState(key)?.isInvalidated, false)
      deepStrictEqual(replacementClient.getQueryData(key), newOwnerUser)
    } finally {
      await replacement.application.dispose()
    }
  } finally {
    await Effect.runPromise(Scope.close(reconnectScope, Exit.void))
  }
} finally {
  await Effect.runPromise(Scope.close(scope, Exit.void))
  await fixture.application.dispose()
}

{
  const client = new QueryClient()
  const bounded = await Effect.runPromise(makeControlledUserWrites(client))
  const boundedScope = Effect.runSync(Scope.make())
  const reactivity = Effect.runSync(Reactivity.make)
  const key = bounded.application.rpcQuery.users.get.queryKey({ id: 1, locale: 'en' })
  client.setQueryData(key, ada)
  try {
    const consumer = await Effect.runPromise(
      makeUserEventConsumer(bounded.application, reactivity).pipe(Scope.provide(boundedScope)),
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        for (let cursor = 1; cursor <= 65; cursor += 1) {
          yield* consumer.deliver({
            schema: 'users.v1',
            ownerKey: consumer.ownerKey,
            cursor,
            kind: 'user.changed',
            id: cursor + 1,
            locale: 'en',
          })
        }
      }),
    )
    await consumer.flush()
    equal(client.getQueryState(key)?.isInvalidated, true)
    equal(consumer.cursor(), 65)
  } finally {
    await Effect.runPromise(Scope.close(boundedScope, Exit.void))
    await bounded.application.dispose()
  }
}

{
  const client = new QueryClient()
  const writing = await Effect.runPromise(makeControlledUserWrites(client))
  const writingScope = Effect.runSync(Scope.make())
  const writingReactivity = Effect.runSync(Reactivity.make)
  const app = writing.application
  writing.seed([ada])
  client.setQueryData(app.rpcQuery.users.list.queryKey(), [ada])
  client.setQueryData(app.httpQuery.users.list.queryKey(), [ada])
  let finishCreation: (() => Promise<void>) | undefined
  try {
    const consumer = await Effect.runPromise(
      makeUserEventConsumer(app, writingReactivity).pipe(Scope.provide(writingScope)),
    )
    const mutation = new MutationObserver(client, app.userWrites.rpcCreate()).mutate({
      name: 'Grace',
    })
    const create = await writing.nextCreate()
    finishCreation = async () => {
      await create.succeed(new User({ id: 3, name: 'Grace', locale: 'en' }))
      await mutation
    }
    await Effect.runPromise(
      consumer.deliver({
        schema: 'users.v1',
        ownerKey: consumer.ownerKey,
        cursor: 1,
        kind: 'users.reset',
      }),
    )
    await consumer.flush()
    equal(client.getQueryState(app.rpcQuery.users.list.queryKey())?.isInvalidated, false)
    deepStrictEqual(
      client.getQueryData(app.rpcQuery.users.list.queryKey())?.map((user) => user.name),
      ['Ada', 'Grace'],
    )
    await create.succeed(new User({ id: 3, name: 'Grace', locale: 'en' }))
    await mutation
    await consumer.flush()
    equal(client.getQueryState(app.rpcQuery.users.list.queryKey())?.isInvalidated, true)
    equal(client.getQueryState(app.httpQuery.users.list.queryKey())?.isInvalidated, true)
  } finally {
    await finishCreation?.()
    await Effect.runPromise(Scope.close(writingScope, Exit.void))
    await app.dispose()
  }
}

{
  const client = new QueryClient()
  const streaming = await Effect.runPromise(makeControlledUserWrites(client))
  const streamScope = Effect.runSync(Scope.make())
  const app = streaming.application
  const reactivity = Effect.runSync(Reactivity.make)
  client.setQueryData(app.rpcQuery.users.list.queryKey(), [ada])
  client.setQueryData(app.httpQuery.users.list.queryKey(), [ada])
  try {
    const attached = await Effect.runPromise(
      attachUserEvents(app, reactivity).pipe(Scope.provide(streamScope)),
    )
    const event = {
      schema: 'users.v1',
      ownerKey: attached.consumer.ownerKey,
      cursor: 1,
      kind: 'users.changed',
    }
    await Effect.runPromise(attached.consume(Stream.fromIterable([event, event])))
    equal(attached.consumer.cursor(), 1)
    equal(client.getQueryState(app.rpcQuery.users.list.queryKey())?.isInvalidated, true)
    equal(client.getQueryState(app.httpQuery.users.list.queryKey())?.isInvalidated, true)
    const failedDelivery = await Effect.runPromiseExit(
      attached.consume(Stream.fail('connection-lost' as const)),
    )
    equal(Exit.isFailure(failedDelivery), true)
    equal(Option.getOrThrow(Exit.findErrorOption(failedDelivery)), 'connection-lost')
  } finally {
    await Effect.runPromise(Scope.close(streamScope, Exit.void))
    await app.dispose()
  }
}

console.log(
  'Packed scoped domain events, replay, native invalidation and optimistic coordination verified',
)
