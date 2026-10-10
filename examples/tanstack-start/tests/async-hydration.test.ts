import { User } from '@effect-api-query/contracts'
import { createMemoryHistory } from '@tanstack/react-router'
import { attachRouterServerSsrUtils } from '@tanstack/react-start/server'
import { Deferred, Effect, Exit, Schema, Scope } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'

import { makeExampleHost } from '../../server/src/web-handler.ts'
import type { RouterSnapshot } from '../src/lib/query-ssr.ts'
import { startServerApplication } from '../src/lib/server-application.ts'
import { createTanStackStartRouter } from '../src/router.tsx'

describe('Start snapshot preparation', () => {
  it('finishes application encoding before publication and decoding before native hydration', async () => {
    const scope = Scope.makeUnsafe()
    const encodingStarted = Deferred.makeUnsafe<undefined>()
    const decodingStarted = Deferred.makeUnsafe<undefined>()
    const encode = Deferred.makeUnsafe<undefined>()
    const decode = Deferred.makeUnsafe<undefined>()
    const host = await Effect.runPromise(makeExampleHost().pipe(Scope.provide(scope)))
    const server = await startServerApplication({ host, authorization: 'allowed' })
    const browser = await startServerApplication({ host, authorization: 'allowed' })
    try {
      const serverRouter = await createTanStackStartRouter({
        application: server,
        scrollRestoration: false,
        preparation: {
          beforeEncode: Deferred.succeed(encodingStarted, undefined).pipe(
            Effect.andThen(Deferred.await(encode)),
          ),
          beforeDecode: Effect.void,
        },
        history: createMemoryHistory({ initialEntries: ['/'] }),
      })
      attachRouterServerSsrUtils({ manifest: undefined, router: serverRouter })
      await serverRouter.load()
      let published = false
      const dehydrate:
        | (() => RouterSnapshot | undefined | Promise<RouterSnapshot | undefined>)
        | undefined = serverRouter.options.dehydrate
      const publication = Promise.resolve(dehydrate?.()).then((value) => {
        published = true
        return value
      })
      await Effect.runPromise(Deferred.await(encodingStarted))
      expect(published).toBe(false)
      await Effect.runPromise(Deferred.succeed(encode, undefined))
      const snapshot = await publication
      if (snapshot?.query?.initial === undefined) {
        throw new Error('Snapshot was not published')
      }
      serverRouter.serverSsr?.setRenderFinished()
      vi.stubGlobal('window', Object.assign(new EventTarget(), { origin: 'http://localhost' }))
      const browserRouter = await createTanStackStartRouter({
        application: browser,
        scrollRestoration: false,
        preparation: {
          beforeEncode: Effect.void,
          beforeDecode: Deferred.succeed(decodingStarted, undefined).pipe(
            Effect.andThen(Deferred.await(decode)),
          ),
        },
        isServer: false,
        history: createMemoryHistory({ initialEntries: ['/'] }),
      })
      const json = JSON.stringify(snapshot.query.initial)
      const initial = Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(JSON.parse(json))
      const hydration = browserRouter.options.hydrate?.({
        ...snapshot,
        query: {
          ...snapshot.query,
          initial,
        },
      })
      await Effect.runPromise(Deferred.await(decodingStarted))
      expect(
        browser.queryClient.getQueryData(browser.rpcQuery.users.list.queryKey()),
      ).toBeUndefined()
      await Effect.runPromise(Deferred.succeed(decode, undefined))
      await hydration
      const users = browser.queryClient.getQueryData(browser.rpcQuery.users.list.queryKey())
      expect(users?.[0]).toBeInstanceOf(User)
      expect(users?.[0]?.name).toBe('Ada Lovelace')
      expect(
        browser.queryClient.getQueryData(
          browser.rpcQuery.users.page.infiniteKey({ cursor: 0, pageSize: 4 }),
        ),
      ).toMatchObject({ pageParams: [0], pages: [{ total: 12 }] })
      serverRouter.serverSsr?.cleanup()
    } finally {
      vi.unstubAllGlobals()
      await Promise.all([server.dispose(), browser.dispose()])
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })

  it('rejects malformed later data before hydrating any earlier query', async () => {
    const scope = Scope.makeUnsafe()
    const host = await Effect.runPromise(makeExampleHost().pipe(Scope.provide(scope)))
    const server = await startServerApplication({ host, authorization: 'allowed' })
    const browser = await startServerApplication({ host, authorization: 'allowed' })
    try {
      const serverRouter = await createTanStackStartRouter({
        application: server,
        history: createMemoryHistory({ initialEntries: ['/'] }),
        scrollRestoration: false,
      })
      attachRouterServerSsrUtils({ manifest: undefined, router: serverRouter })
      await serverRouter.load()
      const dehydrate:
        | (() => RouterSnapshot | undefined | Promise<RouterSnapshot | undefined>)
        | undefined = serverRouter.options.dehydrate
      const snapshot = await dehydrate?.()
      if (snapshot?.query?.initial === undefined) {
        throw new Error('Snapshot was not published')
      }
      serverRouter.serverSsr?.setRenderFinished()
      const lastIndex = snapshot.query.initial.length - 1
      const initial = snapshot.query.initial.map((query, index) =>
        index === lastIndex
          ? { ...query, state: { ...query.state, data: { malformed: true } } }
          : query,
      )
      vi.stubGlobal('window', Object.assign(new EventTarget(), { origin: 'http://localhost' }))
      const browserRouter = await createTanStackStartRouter({
        application: browser,
        isServer: false,
        history: createMemoryHistory({ initialEntries: ['/'] }),
        scrollRestoration: false,
      })
      await expect(
        browserRouter.options.hydrate?.({ ...snapshot, query: { ...snapshot.query, initial } }),
      ).rejects.toMatchObject({ name: 'SchemaError' })
      expect(browser.queryClient.getQueryCache().getAll()).toHaveLength(0)
      serverRouter.serverSsr?.cleanup()
    } finally {
      vi.unstubAllGlobals()
      await Promise.all([server.dispose(), browser.dispose()])
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })

  it('interrupts codec preparation and finishes its finalizers before releasing request clients', async () => {
    const scope = Scope.makeUnsafe()
    const host = await Effect.runPromise(makeExampleHost().pipe(Scope.provide(scope)))
    const started = Deferred.makeUnsafe<undefined>()
    const permit = Deferred.makeUnsafe<undefined>()
    const events: string[] = []
    const application = await startServerApplication({
      host: {
        ...host,
        makeRpcClient: Effect.fnUntraced(function* (authorization: string | undefined) {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              events.push('clients-released')
            }),
          )
          return yield* host.makeRpcClient(authorization)
        }),
      },
      authorization: 'allowed',
    })
    let publishing: Promise<unknown> | undefined
    try {
      const router = await createTanStackStartRouter({
        application,
        history: createMemoryHistory({ initialEntries: ['/'] }),
        scrollRestoration: false,
        preparation: {
          beforeEncode: Effect.scoped(
            Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
              Effect.sync(() => {
                events.push('codec-released')
              }),
            ).pipe(Effect.andThen(Deferred.await(permit))),
          ),
          beforeDecode: Effect.void,
        },
      })
      attachRouterServerSsrUtils({ manifest: undefined, router })
      await router.load()
      publishing = (async () => {
        try {
          await router.options.dehydrate?.()
          return null
        } catch (error) {
          return error
        }
      })()
      await Effect.runPromise(Deferred.await(started))
      await application.dispose()
      expect(events).toStrictEqual(['codec-released', 'clients-released'])
      await expect(publishing).resolves.not.toBeNull()
      router.serverSsr?.cleanup()
    } finally {
      await Effect.runPromise(Deferred.succeed(permit, undefined))
      await publishing
      await application.dispose()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })
})
