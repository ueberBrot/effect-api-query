import type { QueryClient, QueryFilters } from '@tanstack/react-query'
import { Data, Effect, Schema } from 'effect'
import type { Reactivity } from 'effect/reactivity'

import type { ViteReactApplication } from '../../examples/vite-react/src/lib/application.ts'
import { ownerKeyPrefix } from '../../examples/vite-react/src/lib/owner-cache.ts'

const EventEnvelope = {
  schema: Schema.Literal('users.v1'),
  ownerKey: Schema.String,
  cursor: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
}
const UserEventSchema = Schema.Union([
  Schema.Struct({
    ...EventEnvelope,
    kind: Schema.Literal('user.changed'),
    id: Schema.Int,
    locale: Schema.String,
  }),
  Schema.Struct({ ...EventEnvelope, kind: Schema.Literal('users.changed') }),
  Schema.Struct({ ...EventEnvelope, kind: Schema.Literal('users.reset') }),
])

export const decodeUserEvent = Schema.decodeUnknownEffect(UserEventSchema)
type UserEvent = typeof UserEventSchema.Type

class UserEventConsumerUnavailable extends Data.TaggedError('UserEventConsumerUnavailable')<{
  readonly reason: 'inactive-owner' | 'already-registered'
}> {}

interface UserIdentity {
  readonly id: number
  readonly locale: string
}

export type UserEventOwner = Pick<
  ViteReactApplication,
  'identity' | 'isActive' | 'queryClient' | 'rpcQuery' | 'httpQuery'
>

const consumers = new WeakSet<QueryClient>()

export const makeUserEventConsumer = Effect.fnUntraced(function* (
  owner: UserEventOwner,
  reactivity: Reactivity.Reactivity,
  {
    onRefreshError = console.error,
    observedUsers = [],
  }: {
    readonly onRefreshError?: (error: Error) => void
    readonly observedUsers?: readonly UserIdentity[]
  } = {},
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context())
  const ownerKey = JSON.stringify(ownerKeyPrefix(owner.identity))
  const reactivityKeys = {
    directory: JSON.stringify([ownerKey, 'users.directory']),
    all: JSON.stringify([ownerKey, 'users.all']),
    user: ({ id, locale }: UserIdentity) => JSON.stringify([ownerKey, 'user', id, locale]),
  }
  const { queryClient, rpcQuery, httpQuery } = owner
  let pending: Promise<void> | undefined
  let all = false
  let directory = false
  let cursor = 0
  let active = true
  const isActive = () => active && owner.isActive()
  const users = new Map<string, UserIdentity>()
  const markUser = (user: UserIdentity) => {
    if (all) {
      return
    }
    users.set(JSON.stringify([user.id, user.locale]), user)
    if (users.size > 64) {
      all = true
      users.clear()
    }
  }
  const run = Effect.fnUntraced(function* () {
    while (all || directory || users.size > 0) {
      if (!isActive()) {
        all = false
        directory = false
        users.clear()
        return
      }
      if (queryClient.isMutating() > 0) {
        return
      }
      const filters: QueryFilters[] = all
        ? [{ queryKey: rpcQuery.users.key() }, { queryKey: httpQuery.users.key() }]
        : [
            ...(directory
              ? [
                  { queryKey: rpcQuery.users.list.key() },
                  { queryKey: rpcQuery.users.page.key() },
                  { queryKey: httpQuery.users.list.key() },
                  { queryKey: httpQuery.users.page.key() },
                ]
              : []),
            ...[...users.values()].flatMap(({ id, locale }) => [
              { queryKey: rpcQuery.users.get.queryKey({ id, locale }), exact: true },
              {
                queryKey: httpQuery.users.get.queryKey({
                  params: { id },
                  query: { locale },
                }),
                exact: true,
              },
            ]),
          ]
      all = false
      directory = false
      users.clear()
      yield* Effect.promise(async () =>
        Promise.all(filters.map(async (filter) => queryClient.invalidateQueries(filter))),
      )
    }
  })
  const schedule = () => {
    if (pending !== undefined || queryClient.isMutating() > 0) {
      return
    }
    pending = (async () => {
      await Promise.resolve()
      try {
        await runPromise(run())
      } finally {
        pending = undefined
        if (isActive() && (all || directory || users.size > 0)) {
          schedule()
        }
      }
    })()
    const scheduled = pending
    void (async () => {
      try {
        await scheduled
      } catch (error) {
        onRefreshError(new Error('Refreshing user cache failed', { cause: error }))
      }
    })()
  }
  const register = () => [
    reactivity.registerUnsafe([reactivityKeys.directory], () => {
      if (!isActive()) {
        return
      }
      directory = true
      schedule()
    }),
    ...observedUsers.map(({ id, locale }) =>
      reactivity.registerUnsafe([reactivityKeys.user({ id, locale })], () => {
        if (!isActive()) {
          return
        }
        markUser({ id, locale })
        schedule()
      }),
    ),
    reactivity.registerUnsafe([reactivityKeys.all], () => {
      if (!isActive()) {
        return
      }
      all = true
      schedule()
    }),
    queryClient.getMutationCache().subscribe(() => {
      if (isActive() && queryClient.isMutating() === 0 && (all || directory || users.size > 0)) {
        schedule()
      }
    }),
  ]
  yield* Effect.acquireRelease(
    Effect.suspend(() => {
      if (!owner.isActive() || consumers.has(queryClient)) {
        return new UserEventConsumerUnavailable({
          reason: owner.isActive() ? 'already-registered' : 'inactive-owner',
        })
      }
      return Effect.sync(() => {
        consumers.add(queryClient)
        return register()
      })
    }),
    (unregister) =>
      Effect.sync(() => {
        active = false
        all = false
        directory = false
        users.clear()
        consumers.delete(queryClient)
        for (const cancel of unregister) {
          cancel()
        }
      }),
  )
  const deliver = Effect.fnUntraced(function* (input: UserEvent) {
    const event = yield* decodeUserEvent(input)
    if (!isActive() || event.ownerKey !== ownerKey || event.cursor <= cursor) {
      return false
    }
    if (event.cursor !== cursor + 1) {
      all = true
    }
    ;({ cursor } = event)
    if (event.kind === 'user.changed') {
      markUser(event)
      reactivity.invalidateUnsafe([reactivityKeys.directory])
    } else {
      reactivity.invalidateUnsafe([
        event.kind === 'users.reset' ? reactivityKeys.all : reactivityKeys.directory,
      ])
    }
    return true
  })
  const resume = Effect.fnUntraced(function* (replayAvailable: boolean) {
    if (!isActive()) {
      return cursor
    }
    if (!replayAvailable) {
      cursor = 0
      reactivity.invalidateUnsafe([reactivityKeys.all])
    }
    yield* Effect.void
    return cursor
  })
  const flush = async (): Promise<void> =>
    runPromise(
      Effect.gen(function* () {
        let scheduled = pending
        while (scheduled !== undefined) {
          const current = scheduled
          yield* Effect.promise(async () => current)
          scheduled = pending
        }
      }),
    )
  return {
    ownerKey,
    reactivityKeys,
    deliver,
    resume,
    cursor: () => cursor,
    flush,
  }
})
