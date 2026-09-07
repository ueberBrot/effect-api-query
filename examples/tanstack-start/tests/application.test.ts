import { startExampleRpcServer } from '@effect-api-query/server'
import { Effect, Exit, Scope } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  startTanStackStartApplication,
  type TanStackStartApplication,
} from '../src/lib/application.ts'

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
    const owned = application!
    const rpc = owned.rpcQuery.diagnostics.slow.queryOptions({
      input: { durationMs: 60_000, operationId: 'dispose-rpc' },
    })
    const http = owned.httpQuery.diagnostics.slow.queryOptions({
      input: { query: { durationMs: 60_000, operationId: 'dispose-http' } },
    })
    const rpcResult = owned.queryClient.query(rpc).catch(() => 'interrupted')
    const httpResult = owned.queryClient.query(http).catch(() => 'interrupted')
    await expect
      .poll(() =>
        owned.queryClient.query({
          ...owned.httpQuery.diagnostics.status.queryOptions(),
          staleTime: 0,
        }),
      )
      .toMatchObject({ started: 2 })
    await owned.dispose()
    expect(await rpcResult).toBe('interrupted')
    expect(await httpResult).toBe('interrupted')
    expect(owned.queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('keeps a ready RPC client alive until idempotent disposal', async () => {
    const ownedApplication = application
    expect(ownedApplication).toBeDefined()
    if (ownedApplication === undefined) return

    const options = ownedApplication.rpcQuery.users.list.queryOptions()
    const users = await ownedApplication.queryClient.query({ ...options, staleTime: 'static' })

    expect(users).toHaveLength(12)
    expect(users[0]?.name).toBe('Ada Lovelace')
    expect(users[11]?.name).toBe('James Gosling')
    expect(ownedApplication.queryClient.getQueryData(options.queryKey)).toEqual(users)

    await Promise.all([ownedApplication.dispose(), ownedApplication.dispose()])

    expect(ownedApplication.queryClient.getQueryData(options.queryKey)).toBeUndefined()
  })
})

describe('TanStack Start HTTP request ownership', () => {
  it('isolates authorization, cache identity, and disposal between server requests', async () => {
    const scope = Scope.makeUnsafe()
    const applications: Array<TanStackStartApplication> = []
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
      expect(first.queryKey).not.toEqual(second.queryKey)
      await authorized.queryClient.query(first)
      expect(anonymous.queryClient.getQueryData(first.queryKey)).toBeUndefined()
      expect(anonymous.queryClient.getQueryData(second.queryKey)).toBeUndefined()
      await expect(
        anonymous.httpQuery.users.delete.mutationOptions().mutationFn({ params: { id: 1 } }),
      ).rejects.toMatchObject({ name: 'EffectHttpApiQueryError' })
      await authorized.httpQuery.users.delete.mutationOptions().mutationFn({ params: { id: 1 } })
      expect(await anonymous.queryClient.query(second)).toHaveLength(11)
      expect(authorized.queryClient.getQueryData(first.queryKey)).toHaveLength(12)
      await Promise.all([authorized.dispose(), authorized.dispose()])
      expect(authorized.queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(
        await anonymous.queryClient.query(
          anonymous.httpQuery.users.get.queryOptions({ input: { params: { id: 2 }, query: {} } }),
        ),
      ).toMatchObject({ name: 'Edsger Dijkstra' })
    } finally {
      await Promise.all(applications.map(({ dispose }) => dispose()))
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })
})
