import { startExampleRpcServer } from '@effect-api-query/server'
import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { Deferred, Effect, Exit, Schema, Scope, Stream } from 'effect'
import { createRpcQueryUtils } from 'effect-api-query'
import { Rpc, type RpcClient, RpcGroup } from 'effect/unstable/rpc'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fetchStreamSnapshot } from '../src/lib/query-ssr.ts'
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
    const server = await Effect.runPromise(
      startExampleRpcServer().pipe(Scope.provide(serverScope!)),
    )
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
      expect(html).toMatch(/4.*of.*12.*loaded/s)
      expect(html).toMatch(/Page.*1/s)
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
      expect(queryClient.getQueryData(rpcQuery.diagnostics.stream.streamedKey())).toEqual([
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
    const server = await Effect.runPromise(
      startExampleRpcServer().pipe(Scope.provide(serverScope!)),
    )
    const router = await createTanStackStartRouter({
      history: createMemoryHistory({ initialEntries: ['/http'] }),
      rpcUrl: server.rpcUrl,
    })

    try {
      await router.load()
      const html = renderToString(<RouterProvider router={router} />)
      const { httpQuery, queryClient, rpcQuery } = router.options.context

      expect(html).toContain('HTTP users')
      expect(html).toMatch(/HTTP: (?:<!-- -->)?Ada Lovelace/)
      expect(html).toMatch(/HTTP: (?:<!-- -->)?Edsger Dijkstra/)
      expect(html).toMatch(/HTTP:.*4.*of.*12.*loaded/s)
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

  it('finalizes an open stream after its first successful server snapshot', async () => {
    const Watch = Rpc.make('diagnostics.watch', { success: Schema.String, stream: true })
    const group = RpcGroup.make(Watch)
    const finalized = Deferred.makeUnsafe<void>()
    const source = Stream.make('snapshot').pipe(
      Stream.concat(Stream.fromEffect(Effect.never)),
      Stream.ensuring(Deferred.succeed(finalized, undefined).pipe(Effect.asVoid)),
    )
    const client = ((_tag: string, _payload: unknown) => source) as RpcClient.RpcClient.Flat<
      RpcGroup.Rpcs<typeof group>
    >
    const queryClient = new QueryClient()
    const options = createRpcQueryUtils(group, {
      client,
      keyPrefix: ['start'] as const,
    }).diagnostics.watch.streamedOptions()

    const snapshot = await fetchStreamSnapshot(queryClient, options)

    expect(snapshot).toEqual(['snapshot'])
    expect(queryClient.getQueryState(options.queryKey)?.fetchStatus).toBe('idle')
    expect(Deferred.isDoneUnsafe(finalized)).toBe(true)
  })
})
