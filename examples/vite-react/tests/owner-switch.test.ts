import { startExampleRpcServer } from '@effect-api-query/server'
import { MutationObserver } from '@tanstack/react-query'
import { Deferred, Effect, Exit, Scope } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'

import { startViteReactApplication, switchViteReactApplication } from '../src/lib/application.ts'
import type { ViteReactApplication } from '../src/lib/application.ts'

const identity = {
  tenantId: 'example-team',
  userId: 'example-user',
  sessionGeneration: 1,
  permissionGeneration: 1,
}

const storage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    values,
  }
}

describe('existing Vite application owner handoff', () => {
  it('isolates delayed mutation callbacks while preserving the completed server write', async () => {
    const serverScope = await Effect.runPromise(Scope.make())
    const callbackEntered = Deferred.makeUnsafe<undefined>()
    const releaseCallback = Deferred.makeUnsafe<undefined>()
    const persisted = storage()
    let previous: ViteReactApplication | undefined
    let current: ViteReactApplication | undefined
    try {
      const server = await Effect.runPromise(
        startExampleRpcServer().pipe(Scope.provide(serverScope)),
      )
      previous = await startViteReactApplication({
        rpcUrl: server.rpcUrl,
        identity,
        directoryStorage: persisted,
      })
      const captured = previous
      await captured.queryClient.query(captured.rpcQuery.users.list.queryOptions())
      captured.persistDirectory()
      expect(persisted.values.size).toBe(1)
      const streamOptions = captured.rpcQuery.diagnostics.stream.liveOptions()
      const streaming = captured.queryClient.query(streamOptions).catch(() => null)
      await vi.waitFor(() => {
        expect(captured.queryClient.isFetching({ queryKey: streamOptions.queryKey })).toBe(1)
      })
      const writeOptions = captured.rpcQuery.users.create.mutationOptions()
      const mutation = new MutationObserver(captured.queryClient, {
        ...writeOptions,
        mutationFn: async (input) =>
          await captured.runMutation(async () => await writeOptions.mutationFn(input)),
        onSuccess: async (user) => {
          await Effect.runPromise(Deferred.succeed(callbackEntered, undefined))
          await Effect.runPromise(Deferred.await(releaseCallback))
          if (captured.isActive()) {
            captured.queryClient.setQueryData(
              captured.rpcQuery.users.get.queryKey({ id: user.id }),
              user,
            )
          }
          await captured.invalidateUsers()
          captured.persistDirectory()
        },
        onSettled: async () => {
          await captured.invalidateUsers()
          captured.persistDirectory()
        },
      })
      const writing = mutation.mutate({ name: 'Completed before handoff' })
      await Effect.runPromise(Deferred.await(callbackEntered))
      current = await switchViteReactApplication(captured, {
        rpcUrl: server.rpcUrl,
        identity: { ...identity, permissionGeneration: 2 },
        directoryStorage: persisted,
      })
      expect(captured.isActive()).toBe(false)
      expect(captured.queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(captured.queryClient.getMutationCache().getAll()).toHaveLength(0)
      expect(persisted.values.size).toBe(0)
      expect(current.queryClient).not.toBe(captured.queryClient)
      expect(current.rpcQuery.key()).not.toStrictEqual(captured.rpcQuery.key())
      expect(current.httpQuery.key()).not.toStrictEqual(captured.httpQuery.key())
      const users = await current.queryClient.query(current.rpcQuery.users.list.queryOptions())
      expect(users.at(-1)?.name).toBe('Completed before handoff')
      const newKey = current.rpcQuery.users.list.queryKey()
      current.persistDirectory()
      const currentSnapshot = [...persisted.values.entries()]
      await Effect.runPromise(Deferred.succeed(releaseCallback, undefined))
      await writing
      await streaming
      expect(captured.queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(current.queryClient.getQueryState(newKey)?.isInvalidated).toBe(false)
      expect(current.queryClient.getQueryData(newKey)).toBe(users)
      expect([...persisted.values.entries()]).toStrictEqual(currentSnapshot)
    } finally {
      await Effect.runPromise(Deferred.succeed(releaseCallback, undefined))
      await previous?.dispose()
      await current?.dispose()
      await Effect.runPromise(Scope.close(serverScope, Exit.void))
    }
  })
})
