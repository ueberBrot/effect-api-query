import { createMemoryHistory } from '@tanstack/react-router'
import { Effect, Exit, Scope } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { makeExampleHost } from '../../server/src/web-handler.ts'
import type { TanStackStartApplication } from '../src/lib/application.ts'
import { startServerApplication } from '../src/lib/server-application.ts'
import { createTanStackStartRouter } from '../src/router.tsx'

describe('Start request-local execution', () => {
  const applications: TanStackStartApplication[] = []
  const scope = Scope.makeUnsafe()

  afterEach(async () => {
    await Promise.all(applications.splice(0).map(async ({ dispose }) => dispose()))
    vi.unstubAllGlobals()
  })

  it('renders shared host state without network calls and isolates request authority', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await Effect.runPromise(Effect.yieldNow)
        throw new Error('Unexpected network request')
      }),
    )
    const host = await Effect.runPromise(makeExampleHost().pipe(Scope.provide(scope)))
    try {
      const allowed = await startServerApplication({
        host,
        identity: 'reader',
        authorization: 'allowed',
      })
      const denied = await startServerApplication({
        host,
        identity: 'restricted',
        authorization: 'denied',
      })
      applications.push(allowed, denied)
      const create = allowed.rpcQuery.users.create.mutationOptions().mutationFn
      if (create === undefined) {
        throw new Error('Mutation function is missing')
      }
      await create({ name: 'Shared SSR user' })
      const router = await createTanStackStartRouter({
        application: allowed,
        history: createMemoryHistory({ initialEntries: ['/'] }),
      })
      await router.load()
      expect(allowed.queryClient.getQueryData(allowed.rpcQuery.users.list.queryKey())).toHaveLength(
        13,
      )
      expect(denied.queryClient.getQueryData(denied.rpcQuery.users.list.queryKey())).toBeUndefined()
      expect(allowed.rpcQuery.users.list.queryKey()).not.toStrictEqual(
        denied.rpcQuery.users.list.queryKey(),
      )
      const remove = denied.rpcQuery.users.delete.mutationOptions({
        rpcOptions: { headers: { 'x-example-authorization': 'allowed' } },
      }).mutationFn
      if (remove === undefined) {
        throw new Error('Mutation function is missing')
      }
      await expect(remove({ id: 1 })).rejects.toMatchObject({ name: 'EffectRpcQueryError' })
      expect(globalThis.fetch).not.toHaveBeenCalled()
      await allowed.dispose()
      await expect(
        denied.queryClient.query(denied.rpcQuery.users.list.queryOptions()),
      ).resolves.toHaveLength(13)
    } finally {
      await Promise.all(applications.splice(0).map(async ({ dispose }) => dispose()))
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })

  it('settles an aborted capture before releasing its request clients', async () => {
    const ownerScope = Scope.makeUnsafe()
    const host = await Effect.runPromise(makeExampleHost().pipe(Scope.provide(ownerScope)))
    const events: string[] = []
    const application = await startServerApplication({
      host: {
        ...host,
        makeRpcClient: Effect.fnUntraced(function* (authorization: string | undefined) {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              events.push('released')
            }),
          )
          return yield* host.makeRpcClient(authorization)
        }),
      },
      authorization: 'allowed',
    })
    try {
      const capture = application.captureSnapshot(
        application.queryClient,
        application.rpcQuery.diagnostics.stream.streamedOptions(),
      )
      const failure = (async () => {
        try {
          await capture
          return null
        } catch (error) {
          return error
        } finally {
          events.push('settled')
        }
      })()
      expect(application.queryClient.isFetching()).toBe(1)
      await application.dispose()
      await expect(failure).resolves.toMatchObject({ name: 'AbortError' })
      expect(events).toStrictEqual(['settled', 'released'])
      expect(application.queryClient.getQueryCache().hasListeners()).toBe(false)
      expect(application.queryClient.getQueryCache().getAll()).toHaveLength(0)
    } finally {
      await application.dispose()
      await Effect.runPromise(Scope.close(ownerScope, Exit.void))
    }
  })

  it('finishes interrupted local work while another request remains usable', async () => {
    const ownerScope = Scope.makeUnsafe()
    const host = await Effect.runPromise(makeExampleHost().pipe(Scope.provide(ownerScope)))
    const abort = new AbortController()
    const first = await startServerApplication({
      host,
      authorization: 'allowed',
      signal: abort.signal,
    })
    const second = await startServerApplication({ host, authorization: 'allowed' })
    try {
      const read = first.queryClient.query(
        first.rpcQuery.diagnostics.slow.queryOptions({
          input: {
            operationId: 'retired-request',
            durationMs: 60_000,
          },
        }),
      )
      const rejected = (async () => {
        await expect(read).rejects.toMatchObject({ message: 'CancelledError' })
      })()
      await expect
        .poll(async () =>
          second.queryClient.query({
            ...second.rpcQuery.diagnostics.operationStatus.queryOptions({
              input: {
                operationId: 'retired-request',
              },
            }),
            staleTime: 0,
          }),
        )
        .toMatchObject({ started: 1, interrupted: 0 })
      abort.abort()
      await first.dispose()
      await rejected
      await expect(
        second.queryClient.query({
          ...second.rpcQuery.diagnostics.operationStatus.queryOptions({
            input: {
              operationId: 'retired-request',
            },
          }),
          staleTime: 0,
        }),
      ).resolves.toStrictEqual({ started: 1, interrupted: 1 })
      await expect(
        second.queryClient.query(second.httpQuery.users.list.queryOptions()),
      ).resolves.toHaveLength(12)
    } finally {
      await Promise.all([first.dispose(), second.dispose()])
      await Effect.runPromise(Scope.close(ownerScope, Exit.void))
    }
  })

  it('reports aborted request cleanup failures and preserves explicit disposal rejection', async () => {
    const ownerScope = Scope.makeUnsafe()
    const host = await Effect.runPromise(makeExampleHost().pipe(Scope.provide(ownerScope)))
    const abort = new AbortController()
    const failure = new Error('Request resource finalizer failed')
    const log = vi.spyOn(console, 'error').mockReturnValue(undefined)
    const application = await startServerApplication({
      host: {
        ...host,
        makeRpcClient: Effect.fnUntraced(function* (authorization: string | undefined) {
          yield* Effect.addFinalizer(() => Effect.die(failure))
          return yield* host.makeRpcClient(authorization)
        }),
      },
      authorization: 'allowed',
      signal: abort.signal,
    })
    try {
      abort.abort()
      await expect(application.dispose()).rejects.toBe(failure)
      expect(log).toHaveBeenCalledWith('Start resource cleanup failed', failure)
    } finally {
      log.mockRestore()
      await Effect.runPromise(Scope.close(ownerScope, Exit.void))
    }
  })
})
