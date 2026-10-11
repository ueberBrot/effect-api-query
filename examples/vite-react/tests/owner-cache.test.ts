import { MutationObserver, onlineManager, QueryClient } from '@tanstack/react-query'
import { Deferred, Effect } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'

import { makeOwnerCache, ownerKeyPrefix } from '../src/lib/owner-cache.ts'

const identity = {
  tenantId: 'team-a',
  userId: 'user-a',
  sessionGeneration: 3,
  permissionGeneration: 7,
}

const makeStorage = () => {
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

const makeCache = (
  queryClient: QueryClient,
  storage: ReturnType<typeof makeStorage>,
  owner = identity,
) => {
  const prefix = ownerKeyPrefix(owner)
  return makeOwnerCache({
    identity: owner,
    queryClient,
    directoryKeys: {
      rpc: [...prefix, 'rpc', 'users', 'list', 'query'],
      http: [...prefix, 'http', 'users', 'list', 'query'],
    },
    storage,
  })
}

describe('application private cache owner', () => {
  it('attempts accepted native writes without leaving an offline queue on owner handoff', async () => {
    const queryClient = new QueryClient()
    const owner = makeCache(queryClient, makeStorage())
    const mutation = new MutationObserver(
      queryClient,
      owner.trackMutationOptions({
        mutationFn: async () => await Promise.resolve(4),
      }),
    )
    onlineManager.setOnline(false)
    const result = mutation.mutate()
    try {
      await vi.waitFor(() => {
        expect(mutation.getCurrentResult().status).toBe('success')
      })
      await expect(result).resolves.toBe(4)
      await owner.retire()
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    } finally {
      onlineManager.setOnline(true)
      await queryClient.resumePausedMutations()
      await result
      await owner.retire()
    }
  })

  it('drains an accepted native mutation and rejects new native work after retirement', async () => {
    const queryClient = new QueryClient()
    const stored = makeStorage()
    const owner = makeCache(queryClient, stored)
    queryClient.setQueryData(
      [...ownerKeyPrefix(identity), 'rpc', 'users', 'list', 'query'],
      [{ id: 1, name: 'Ada', locale: 'en' }],
    )
    owner.persistDirectory()
    expect(stored.values.size).toBe(1)
    const entered = Deferred.makeUnsafe<undefined>()
    const release = Deferred.makeUnsafe<number>()
    const mutation = new MutationObserver(
      queryClient,
      owner.trackMutationOptions({
        mutationFn: async () => {
          await Effect.runPromise(Deferred.succeed(entered, undefined))
          return await Effect.runPromise(Deferred.await(release))
        },
      }),
    )
    const result = mutation.mutate()
    await Effect.runPromise(Deferred.await(entered))
    owner.persistDirectory()
    expect(stored.values.size).toBe(0)
    const retiring = owner.retire()
    await Effect.runPromise(Deferred.succeed(release, 4))
    await expect(result).resolves.toBe(4)
    await retiring
    const late = new MutationObserver(
      queryClient,
      owner.trackMutationOptions({
        mutationFn: async () => await Promise.resolve(5),
      }),
    )
    await expect(late.mutate()).rejects.toThrow('Owner is inactive')
    queryClient.clear()
  })

  it('preserves an explicit reload snapshot while retiring its old in-memory owner', async () => {
    const storage = makeStorage()
    const queryClient = new QueryClient()
    const owner = makeCache(queryClient, storage)
    const key = [...ownerKeyPrefix(identity), 'rpc', 'users', 'list', 'query']
    queryClient.setQueryData(key, [{ id: 2, name: 'Grace', locale: 'fr' }])
    await owner.retire({ discardPersistence: false })
    expect(owner.isActive()).toBe(false)
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(storage.values.size).toBe(1)
    const browser = new QueryClient()
    const resumed = makeCache(browser, storage)
    expect(resumed.restoreDirectory()).toBe(true)
    expect(browser.getQueryData(key)).toStrictEqual([{ id: 2, name: 'Grace', locale: 'fr' }])
    expect(browser.getQueryState(key)?.dataUpdatedAt).toBe(0)
    await resumed.retire()
    expect(storage.values.size).toBe(0)
    expect(resumed.restoreDirectory()).toBe(false)
  })

  it('restores only validated directory DTOs for the same owner and compatible busters', () => {
    const storage = makeStorage()
    const server = new QueryClient()
    const original = makeCache(server, storage)
    const key = [...ownerKeyPrefix(identity), 'rpc', 'users', 'list', 'query']
    server.setQueryData(key, [{ id: 1, name: 'Ada', locale: 'en' }])
    original.persistDirectory()
    const [saved] = [...storage.values.entries()]
    expect(saved).toBeDefined()
    if (saved === undefined) {
      throw new Error('Expected a persisted directory')
    }
    const [storageKey, json] = saved
    const browser = new QueryClient()
    const restored = makeCache(browser, storage)
    expect(restored.restoreDirectory()).toBe(true)
    expect(browser.getQueryData(key)).toStrictEqual([{ id: 1, name: 'Ada', locale: 'en' }])
    browser.clear()
    const snapshot = {
      identity,
      schemaVersion: 1,
      keyVersion: 1,
      directories: [{ adapter: 'rpc', data: [{ id: 1, name: 'Ada', locale: 'en' }] }],
    }
    for (const incompatible of [
      { ...snapshot, identity: { ...identity, tenantId: 'team-b' } },
      { ...snapshot, identity: { ...identity, permissionGeneration: 8 } },
      { ...snapshot, identity: { ...identity, sessionGeneration: 4 } },
      { ...snapshot, schemaVersion: 2 },
      { ...snapshot, keyVersion: 2 },
      {
        ...snapshot,
        directories: [{ adapter: 'rpc', data: [{ id: 'invalid', name: 'Ada', locale: 'en' }] }],
      },
    ]) {
      storage.setItem(storageKey, JSON.stringify(incompatible))
      expect(restored.restoreDirectory()).toBe(false)
      expect(browser.getQueryCache().getAll()).toHaveLength(0)
      expect(storage.getItem(storageKey)).toBeNull()
    }
    storage.setItem(storageKey, json)
    const other = makeCache(browser, storage, { ...identity, tenantId: 'team-b' })
    expect(other.restoreDirectory()).toBe(false)
    expect(storage.getItem(storageKey)).toBe(json)
    server.clear()
    browser.clear()
  })

  it('retires immediately, removes private state, and lets accepted mutations settle', async () => {
    const queryClient = new QueryClient()
    const storage = makeStorage()
    const owner = makeCache(queryClient, storage)
    const key = [...ownerKeyPrefix(identity), 'rpc', 'users', 'list', 'query']
    queryClient.setQueryData(key, [{ id: 1, name: 'Ada', locale: 'en' }])
    owner.persistDirectory()
    expect(storage.values.size).toBe(1)
    const complete = Deferred.makeUnsafe<number>()
    let serverWriteCompleted = false
    const result = owner.runMutation(async () => {
      const value = await Effect.runPromise(Deferred.await(complete))
      serverWriteCompleted = true
      return value
    })
    await Promise.resolve()
    const retiring = owner.retire()
    expect(owner.isActive()).toBe(false)
    await expect(owner.runMutation(async () => await Promise.resolve(3))).rejects.toThrow(
      'Owner is inactive',
    )
    await Promise.resolve()
    expect(queryClient.getQueryData(key)).toBeUndefined()
    expect(storage.values.size).toBe(0)
    owner.persistDirectory()
    expect(storage.values.size).toBe(0)
    let retired = false
    void (async () => {
      await retiring
      retired = true
    })()
    await Promise.resolve()
    expect(retired).toBe(false)
    await Effect.runPromise(Deferred.succeed(complete, 2))
    await expect(result).resolves.toBe(2)
    await retiring
    expect(serverWriteCompleted).toBe(true)
    expect(retired).toBe(true)
    await owner.retire()
  })
})
