import { User } from '@effect-api-query/contracts'
import type { ExampleRpcClient } from '@effect-api-query/contracts/client'
import { startExampleRpcServer } from '@effect-api-query/server'
import { MutationObserver } from '@tanstack/react-query'
import { Deferred, Effect, Exit, Scope, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'

import { startTanStackStartApplication } from '../src/lib/application.ts'
import type { TanStackStartApplication } from '../src/lib/application.ts'

describe('TanStack Start application ownership', () => {
  let application: TanStackStartApplication | undefined
  let serverScope: Scope.Closeable | undefined

  beforeEach(async () => {
    serverScope = await Effect.runPromise(Scope.make())
    const server = await Effect.runPromise(startExampleRpcServer().pipe(Scope.provide(serverScope)))
    application = await startTanStackStartApplication({ rpcUrl: server.rpcUrl })
  })

  afterEach(async () => {
    await application?.dispose()
    if (serverScope !== undefined) {
      await Effect.runPromise(Scope.close(serverScope, Exit.void))
    }
  })

  it('interrupts both ready clients before clearing the disposed request cache', async () => {
    const owned = application
    if (owned === undefined) {
      throw new Error('Application was not initialized')
    }
    const rpc = owned.rpcQuery.diagnostics.slow.queryOptions({
      input: { durationMs: 60_000, operationId: 'dispose-rpc' },
    })
    const http = owned.httpQuery.diagnostics.slow.queryOptions({
      input: { query: { durationMs: 60_000, operationId: 'dispose-http' } },
    })
    const rpcResult = owned.queryClient.query(rpc).catch(() => 'interrupted')
    const httpResult = owned.queryClient.query(http).catch(() => 'interrupted')
    await expect
      .poll(async () =>
        owned.queryClient.query({
          ...owned.httpQuery.diagnostics.status.queryOptions(),
          staleTime: 0,
        }),
      )
      .toMatchObject({ started: 2 })
    await owned.dispose()
    await expect(rpcResult).resolves.toBe('interrupted')
    await expect(httpResult).resolves.toBe('interrupted')
    expect(owned.queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('keeps a ready RPC client alive until idempotent disposal', async () => {
    const ownedApplication = application
    expect(ownedApplication).toBeDefined()
    if (ownedApplication === undefined) {
      return
    }

    const options = ownedApplication.rpcQuery.users.list.queryOptions()
    const users = await ownedApplication.queryClient.query({ ...options, staleTime: 'static' })

    expect(users).toHaveLength(12)
    expect(users[0]?.name).toBe('Ada Lovelace')
    expect(users[11]?.name).toBe('James Gosling')
    expect(ownedApplication.queryClient.getQueryData(options.queryKey)).toStrictEqual(users)

    await Promise.all([ownedApplication.dispose(), ownedApplication.dispose()])

    expect(ownedApplication.queryClient.getQueryData(options.queryKey)).toBeUndefined()
  })
})

describe('TanStack Start HTTP request ownership', () => {
  it('isolates authorization, cache identity, and disposal between server requests', async () => {
    const scope = Scope.makeUnsafe()
    const applications: TanStackStartApplication[] = []
    try {
      const server = await Effect.runPromise(startExampleRpcServer().pipe(Scope.provide(scope)))
      const authorized = await startTanStackStartApplication({
        rpcUrl: server.rpcUrl,
        identity: 'authorized-reader',
        httpAuthorization: 'allowed',
      })
      applications.push(authorized)
      const anonymous = await startTanStackStartApplication({
        rpcUrl: server.rpcUrl,
        identity: 'anonymous-reader',
        httpAuthorization: '',
      })
      applications.push(anonymous)
      const first = authorized.httpQuery.users.list.queryOptions()
      const second = anonymous.httpQuery.users.list.queryOptions()
      expect(first.queryKey).not.toStrictEqual(second.queryKey)
      await authorized.queryClient.query(first)
      expect(anonymous.queryClient.getQueryData(first.queryKey)).toBeUndefined()
      expect(anonymous.queryClient.getQueryData(second.queryKey)).toBeUndefined()
      await expect(
        anonymous.httpQuery.users.delete.mutationOptions().mutationFn({ params: { id: 1 } }),
      ).rejects.toMatchObject({ name: 'EffectHttpApiQueryError' })
      await authorized.httpQuery.users.delete.mutationOptions().mutationFn({ params: { id: 1 } })
      await expect(anonymous.queryClient.query(second)).resolves.toHaveLength(11)
      expect(authorized.queryClient.getQueryData(first.queryKey)).toHaveLength(12)
      await Promise.all([authorized.dispose(), authorized.dispose()])
      expect(authorized.queryClient.getQueryCache().getAll()).toHaveLength(0)
      await expect(
        anonymous.queryClient.query(
          anonymous.httpQuery.users.get.queryOptions({ input: { params: { id: 2 }, query: {} } }),
        ),
      ).resolves.toMatchObject({ name: 'Edsger Dijkstra' })
    } finally {
      await Promise.all(applications.map(async ({ dispose }) => dispose()))
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })
})

describe('TanStack Start execution settlement', () => {
  it.each(['unary', 'stream'] as const)(
    'drains ordinary %s query finalizers before disposing ready clients',
    async (view) => {
      const entered = Deferred.makeUnsafe<undefined>()
      const closing = Deferred.makeUnsafe<undefined>()
      const release = Deferred.makeUnsafe<undefined>()
      const events: string[] = []
      const cleanup = Deferred.succeed(closing, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(Effect.sync(() => events.push('finalized'))),
      )
      const source =
        view === 'unary'
          ? Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(cleanup),
            )
          : Stream.fromEffect(Deferred.succeed(entered, undefined).pipe(Effect.as('ready'))).pipe(
              Stream.concat(Stream.never),
              Stream.ensuring(cleanup),
            )
      const application = await startTanStackStartApplication({
        rpcUrl: 'http://example.test/rpc',
        rpcClient: {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          client: (() => source) as ExampleRpcClient,
          runPromiseExit: Effect.runPromiseExit,
          dispose: async () => {
            events.push('disposed')
            await Promise.resolve()
          },
        },
      })
      const options =
        view === 'unary'
          ? application.rpcQuery.diagnostics.slow.queryOptions({
              input: { durationMs: 60_000, operationId: 'disposal' },
            })
          : application.rpcQuery.diagnostics.stream.streamedOptions()
      const pending =
        view === 'unary'
          ? application.queryClient.query(
              application.rpcQuery.diagnostics.slow.queryOptions({
                input: { durationMs: 60_000, operationId: 'disposal' },
              }),
            )
          : application.queryClient.query(application.rpcQuery.diagnostics.stream.streamedOptions())
      const outcome = Promise.allSettled([pending])
      try {
        await Effect.runPromise(Deferred.await(entered))
        const disposal = application.dispose()
        await Effect.runPromise(Deferred.await(closing))
        await Effect.runPromise(Effect.sleep('20 millis'))
        expect(events).toStrictEqual([])
        await Effect.runPromise(Deferred.succeed(release, undefined))
        await disposal
        await outcome
        expect(events).toStrictEqual(['finalized', 'disposed'])
        await expect(
          application.queryClient.query({
            queryKey: options.queryKey,
            queryFn: async () => await Promise.resolve('late'),
          }),
        ).rejects.toMatchObject({ name: 'AbortError' })
        expect(events).toStrictEqual(['finalized', 'disposed'])
      } finally {
        await Effect.runPromise(Deferred.succeed(release, undefined))
        await application.dispose()
        await outcome
      }
    },
  )

  it.each(['rpc', 'http'] as const)(
    'drains an accepted %s mutation without cancelling its work',
    async (adapter) => {
      const entered = Deferred.makeUnsafe<undefined>()
      const release = Deferred.makeUnsafe<User>()
      const events: string[] = []
      const mutation = Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.tap(() => Effect.sync(() => events.push('completed'))),
      )
      const application = await startTanStackStartApplication({
        rpcUrl: 'http://example.test/rpc',
        rpcClient: {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          client: (() => mutation) as ExampleRpcClient,
          runPromiseExit: Effect.runPromiseExit,
          dispose: async () => {
            events.push('disposed')
            await Promise.resolve()
          },
        },
        fetch: async () => {
          await Effect.runPromise(Deferred.succeed(entered, undefined))
          const user = await Effect.runPromise(Deferred.await(release))
          events.push('completed')
          return Response.json(user)
        },
      })
      const pending =
        adapter === 'rpc'
          ? new MutationObserver(
              application.queryClient,
              application.rpcQuery.users.create.mutationOptions(),
            ).mutate({ name: 'Ada' })
          : new MutationObserver(
              application.queryClient,
              application.httpQuery.users.create.mutationOptions(),
            ).mutate({ payload: { name: 'Ada' } })
      const outcome = Promise.allSettled([pending])
      try {
        await Effect.runPromise(Deferred.await(entered))
        const disposal = application.dispose()
        await Effect.runPromise(Effect.sleep('20 millis'))
        expect(events).toStrictEqual([])
        const user = new User({ id: 1, name: 'Ada', locale: 'en' })
        await Effect.runPromise(Deferred.succeed(release, user))
        await expect(pending).resolves.toStrictEqual(user)
        await disposal
        expect(events).toStrictEqual(['completed', 'disposed'])
        const late =
          adapter === 'rpc'
            ? new MutationObserver(
                application.queryClient,
                application.rpcQuery.users.create.mutationOptions(),
              ).mutate({ name: 'late' })
            : new MutationObserver(
                application.queryClient,
                application.httpQuery.users.create.mutationOptions(),
              ).mutate({ payload: { name: 'late' } })
        await expect(late).rejects.toMatchObject({ name: 'AbortError' })
        expect(events).toStrictEqual(['completed', 'disposed'])
      } finally {
        await Effect.runPromise(
          Deferred.succeed(release, new User({ id: 1, name: 'Ada', locale: 'en' })),
        )
        await application.dispose()
        await outcome
      }
    },
  )
})
