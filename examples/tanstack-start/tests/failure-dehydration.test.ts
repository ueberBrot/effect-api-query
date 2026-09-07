import { startExampleRpcServer } from '@effect-api-query/server'
import { type QueryKey } from '@tanstack/react-query'
import { createMemoryHistory } from '@tanstack/react-router'
import { attachRouterServerSsrUtils } from '@tanstack/react-start/server'
import { Effect, Exit, Scope } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TanStackStartApplication } from '../src/lib/application.ts'
import { createTanStackStartRouter } from '../src/router.tsx'

describe('TanStack Start router dehydration', () => {
  const applications: Array<TanStackStartApplication> = []
  let serverScope: Scope.Closeable | undefined

  beforeEach(async () => {
    serverScope = await Effect.runPromise(Scope.make())
  })

  afterEach(async () => {
    await Promise.all(applications.splice(0).map(({ dispose }) => dispose()))
    if (serverScope !== undefined) {
      await Effect.runPromise(Scope.close(serverScope, Exit.void))
    }
    vi.unstubAllGlobals()
  })

  it.each([
    { route: '/', adapter: 'rpc' },
    { route: '/http', adapter: 'http' },
  ] as const)(
    'round-trips $adapter query data through the router hooks without refetching',
    async ({ route, adapter }) => {
      const server = await Effect.runPromise(
        startExampleRpcServer().pipe(Scope.provide(serverScope!)),
      )
      const serverRouter = await createTanStackStartRouter({
        history: createMemoryHistory({ initialEntries: [route] }),
        rpcUrl: server.rpcUrl,
        scrollRestoration: false,
      })
      const serverApplication = serverRouter.options.context
      applications.push(serverApplication)
      attachRouterServerSsrUtils({ manifest: undefined, router: serverRouter })

      await serverRouter.load()
      const dehydrated = await serverRouter.options.dehydrate?.()
      if (dehydrated === undefined) throw new Error('Router dehydration is not configured')
      serverRouter.serverSsr?.setRenderFinished()

      const browserWindow = Object.assign(new EventTarget(), { origin: 'http://localhost' })
      vi.stubGlobal('window', browserWindow)
      const browserRouter = await createTanStackStartRouter({
        history: createMemoryHistory({ initialEntries: [route] }),
        isServer: false,
        rpcUrl: server.rpcUrl,
        scrollRestoration: false,
      })
      const browserApplication = browserRouter.options.context
      applications.push(browserApplication)
      const usersKey =
        adapter === 'http'
          ? browserApplication.httpQuery.users.list.queryKey()
          : browserApplication.rpcQuery.users.list.queryKey()
      const pagesKey =
        adapter === 'http'
          ? browserApplication.httpQuery.users.page.infiniteKey({
              query: { cursor: 0, pageSize: 4 },
            })
          : browserApplication.rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 })
      const watchedKeys: ReadonlyArray<QueryKey> = [usersKey, pagesKey]
      let duplicateFetches = 0
      const unsubscribe = browserApplication.queryClient.getQueryCache().subscribe((event) => {
        if (
          watchedKeys.some(
            (queryKey) =>
              event.query.queryHash ===
              browserApplication.queryClient.getQueryCache().find({ queryKey })?.queryHash,
          ) &&
          event.query.state.fetchStatus === 'fetching'
        ) {
          duplicateFetches += 1
        }
      })

      await browserRouter.options.hydrate?.(dehydrated)
      await browserRouter.load()

      expect(browserApplication.queryClient.getQueryData(usersKey)).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Ada Lovelace' })]),
      )
      expect(browserApplication.queryClient.getQueryData(pagesKey)).toMatchObject({
        pageParams: [0],
        pages: [{ total: 12, users: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }],
      })
      expect(duplicateFetches).toBe(0)
      unsubscribe()
      serverRouter.serverSsr?.cleanup()
    },
  )

  it.each([
    { route: '/failure', adapter: 'rpc' },
    { route: '/http-failure', adapter: 'http' },
  ] as const)(
    'loads the $adapter failure route but omits its failed query from router dehydration',
    async ({ route, adapter }) => {
      const server = await Effect.runPromise(
        startExampleRpcServer().pipe(Scope.provide(serverScope!)),
      )
      const router = await createTanStackStartRouter({
        history: createMemoryHistory({ initialEntries: [route] }),
        rpcUrl: server.rpcUrl,
        scrollRestoration: false,
      })
      const application = router.options.context
      applications.push(application)
      attachRouterServerSsrUtils({ manifest: undefined, router })

      await router.load()
      const failureKey =
        adapter === 'http'
          ? application.httpQuery.diagnostics.fail.queryKey()
          : application.rpcQuery.diagnostics.fail.queryKey()
      const dehydrated = await router.options.dehydrate?.()

      expect(application.queryClient.getQueryState(failureKey)?.status).toBe('error')
      expect(application.queryClient.getQueryState(failureKey)?.error).toMatchObject({
        name: adapter === 'http' ? 'EffectHttpApiQueryError' : 'EffectRpcQueryError',
      })
      expect(dehydrated).not.toHaveProperty('dehydratedQueryClient')
      router.serverSsr?.cleanup()
    },
  )
})
