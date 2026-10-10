import { startExampleRpcServer } from '@effect-api-query/server'
import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { Deferred, Effect, Exit, Schema, Scope, Stream } from 'effect'
import { createRpcQueryUtils, fetchStreamSnapshot } from 'effect-api-query'
import { Rpc, RpcGroup } from 'effect/rpc'
import type { RpcClient } from 'effect/rpc'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'

import { fetchStreamSnapshot as captureStreamSnapshot } from '../../../src/index.ts'
import type { StreamSnapshotOptions } from '../../../src/index.ts'
import { createTanStackStartRouter } from '../src/router.tsx'

describe('TanStack Start server rendering', () => {
  let serverScope: Scope.Closeable | undefined

  beforeEach(async () => {
    serverScope = await Effect.runPromise(Scope.make())
  })

  afterEach(async () => {
    if (serverScope !== undefined) {
      await Effect.runPromise(Scope.close(serverScope, Exit.void))
    }
  })

  it('renders a cancelled server snapshot from generated query and stream options', async () => {
    if (serverScope === undefined) {
      throw new Error('Server scope was not initialized')
    }
    const server = await Effect.runPromise(startExampleRpcServer().pipe(Scope.provide(serverScope)))
    const router = await createTanStackStartRouter({
      history: createMemoryHistory({ initialEntries: ['/'] }),
      rpcUrl: server.rpcUrl,
    })

    try {
      await router.load()
      const html = renderToString(<RouterProvider router={router} />)
      const { queryClient, rpcQuery } = router.options.context

      expect(html).toContain('Ada Lovelace')
      expect(html).toContain('Edsger Dijkstra')
      expect(html).toMatch(/4.*of.*12.*loaded/su)
      expect(html).toMatch(/Page.*1/su)
      expect(html).toContain('Accumulated stream')
      expect(html).toContain('Connection opened')
      expect(html).toContain('Current state:')
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toHaveLength(12)
      expect(
        queryClient.getQueryData(rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 })),
      ).toMatchObject({
        pageParams: [0],
        pages: [
          {
            total: 12,
            users: [
              { id: 1, locale: 'en', name: 'Ada Lovelace' },
              { id: 2, locale: 'nl', name: 'Edsger Dijkstra' },
              { id: 3, locale: 'en', name: 'Alan Turing' },
              { id: 4, locale: 'en', name: 'Barbara Liskov' },
            ],
          },
        ],
      })
      expect(
        queryClient.getQueryState(rpcQuery.diagnostics.stream.streamedKey())?.fetchStatus,
      ).toBe('idle')
      expect(queryClient.getQueryData(rpcQuery.diagnostics.stream.streamedKey())).toStrictEqual([
        'Connection opened',
      ])
      expect(queryClient.getQueryState(rpcQuery.diagnostics.stream.liveKey())?.fetchStatus).toBe(
        'idle',
      )
      expect(queryClient.getQueryData(rpcQuery.diagnostics.stream.liveKey())).toBe(
        'Connection opened',
      )
    } finally {
      await router.options.context.dispose()
    }
  })

  it('renders generated HTTP directory and page queries in the server snapshot', async () => {
    if (serverScope === undefined) {
      throw new Error('Server scope was not initialized')
    }
    const server = await Effect.runPromise(startExampleRpcServer().pipe(Scope.provide(serverScope)))
    const router = await createTanStackStartRouter({
      history: createMemoryHistory({ initialEntries: ['/http'] }),
      rpcUrl: server.rpcUrl,
    })

    try {
      await router.load()
      const html = renderToString(<RouterProvider router={router} />)
      const { httpQuery, queryClient, rpcQuery } = router.options.context

      expect(html).toContain('HTTP users')
      expect(html).toMatch(/HTTP: (?:<!-- -->)?Ada Lovelace/u)
      expect(html).toMatch(/HTTP: (?:<!-- -->)?Edsger Dijkstra/u)
      expect(html).toMatch(/HTTP:.*4.*of.*12.*loaded/su)
      expect(html).toContain('HTTP user query skipped')
      expect(queryClient.getQueryData(httpQuery.users.list.queryKey())).toHaveLength(12)
      expect(
        queryClient.getQueryData(
          httpQuery.users.page.infiniteKey({ query: { cursor: 0, pageSize: 4 } }),
        ),
      ).toMatchObject({
        pageParams: [0],
        pages: [{ total: 12, users: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }],
      })
      expect(queryClient.getQueryData(rpcQuery.users.list.queryKey())).toBeUndefined()
      expect(queryClient.isFetching()).toBe(0)
    } finally {
      await router.options.context.dispose()
    }
  })

  it.each([false, true])(
    'finalizes a stream after its first new snapshot (cached: %s)',
    async (cached) => {
      const Watch = Rpc.make('diagnostics.watch', { success: Schema.String, stream: true })
      const group = RpcGroup.make(Watch)
      // Void is the deliberate success channel of this Effect factory.
      // oxlint-disable-next-line typescript/no-invalid-void-type
      const finalized = Deferred.makeUnsafe<void>()
      const source = Stream.make('snapshot').pipe(
        Stream.concat(Stream.fromEffect(Effect.never)),
        Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
      )
      // SAFETY: This group contains only the watch RPC, whose handler always returns the typed source.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const client = (() => source) as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>
      const queryClient = new QueryClient()
      const options = createRpcQueryUtils(group, {
        client,
        keyPrefix: ['start'] as const,
      }).diagnostics.watch.streamedOptions()
      if (cached) {
        queryClient.setQueryData(options.queryKey, ['previous'])
      }

      const controls: StreamSnapshotOptions = { mode: 'fresh', timeoutMs: 1000 }
      const snapshot = await captureStreamSnapshot(queryClient, options, controls)

      expect(snapshot).toStrictEqual(['snapshot'])
      expect(queryClient.getQueryState(options.queryKey)?.fetchStatus).toBe('idle')
      expect(Deferred.isDoneUnsafe(finalized)).toBe(true)
    },
  )

  it('settles and releases its listener when cancelled before the first streamed value', async () => {
    const Watch = Rpc.make('watch', { success: Schema.String, stream: true })
    const group = RpcGroup.make(Watch)
    // Void is the deliberate success channel of this Effect factory.
    // oxlint-disable-next-line typescript/no-invalid-void-type
    const started = Deferred.makeUnsafe<void>()
    // Void is the deliberate success channel of this Effect factory.
    // oxlint-disable-next-line typescript/no-invalid-void-type
    const finalized = Deferred.makeUnsafe<void>()
    const source = Stream.fromEffect(
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    ).pipe(Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)))
    // SAFETY: This group contains only the watch RPC, whose handler always returns the typed source.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const client = (() => source) as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>
    const queryClient = new QueryClient()
    const options = createRpcQueryUtils(group, {
      client,
      keyPrefix: ['cancel-snapshot'],
    }).watch.streamedOptions()

    try {
      const snapshot = fetchStreamSnapshot(queryClient, options)
      const rejected = (async () => {
        await expect(snapshot).rejects.toMatchObject({ message: 'CancelledError', revert: true })
      })()
      await Effect.runPromise(Deferred.await(started))
      expect(queryClient.getQueryCache().hasListeners()).toBe(true)
      await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true })
      await rejected
      await Effect.runPromise(Deferred.await(finalized))
      expect(queryClient.getQueryCache().hasListeners()).toBe(false)
    } finally {
      queryClient.clear()
    }
  }, 1500)

  it('releases its listener on failure and can take a fresh snapshot after a cached error', async () => {
    const Watch = Rpc.make('watch', { success: Schema.String, stream: true })
    const group = RpcGroup.make(Watch)
    // Void is the deliberate success channel of this Effect factory.
    // oxlint-disable-next-line typescript/no-invalid-void-type
    const finalized = Deferred.makeUnsafe<void>()
    const source = Stream.make('recovered').pipe(
      Stream.concat(Stream.fromEffect(Effect.never)),
      Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
    )
    // SAFETY: This group contains only the watch RPC, whose handler always returns the typed source.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const client = (() => source) as RpcClient.RpcClient.Flat<RpcGroup.Rpcs<typeof group>>
    const queryClient = new QueryClient()
    const options = createRpcQueryUtils(group, {
      client,
      keyPrefix: ['recover-snapshot'],
    }).watch.streamedOptions()
    const failure = new Error('first request failed')

    try {
      await expect(
        fetchStreamSnapshot(queryClient, {
          ...options,
          queryFn: () => {
            throw failure
          },
        }),
      ).rejects.toBe(failure)
      expect(queryClient.getQueryCache().hasListeners()).toBe(false)

      await expect(fetchStreamSnapshot(queryClient, options)).resolves.toStrictEqual(['recovered'])
      await Effect.runPromise(Deferred.await(finalized))
      expect(queryClient.getQueryCache().hasListeners()).toBe(false)
      expect(queryClient.isFetching()).toBe(0)
    } finally {
      queryClient.clear()
    }
  }, 1500)
})
