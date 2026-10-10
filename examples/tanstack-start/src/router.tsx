import { createRouter } from '@tanstack/react-router'
import type { RouterHistory } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

import { ErrorPage, NotFoundPage, PendingPage } from './components/router-status.tsx'
import { reportCleanupFailure, startTanStackStartApplication } from './lib/application.ts'
import type { TanStackStartApplication } from './lib/application.ts'
import { setupQuerySsr } from './lib/query-ssr.ts'
import { startRequestApplication } from './lib/server-host.ts'
import type { SnapshotPreparation } from './lib/snapshot-preparation.ts'
import { routeTree } from './routeTree.gen.ts'

export interface RouterOptions {
  readonly history?: RouterHistory
  readonly preparation?: SnapshotPreparation
  readonly isServer?: boolean
  readonly scrollRestoration?: boolean
}

export type CreateTanStackStartRouterOptions = RouterOptions &
  (
    | { readonly application: TanStackStartApplication; readonly rpcUrl?: never }
    | { readonly application?: never; readonly rpcUrl: string }
  )

const registerBrowserDisposal = (application: TanStackStartApplication): void => {
  if (typeof window === 'undefined') {
    return
  }
  const dispose = () => {
    void reportCleanupFailure(application.dispose())
  }
  window.addEventListener('pagehide', dispose, { once: true })
}

export const createTanStackStartRouter = async (options: CreateTanStackStartRouterOptions) => {
  const { history, isServer, scrollRestoration = true } = options
  const application =
    options.application ?? (await startTanStackStartApplication({ rpcUrl: options.rpcUrl }))
  const navigation: { -readonly [Key in keyof RouterOptions]: RouterOptions[Key] } = {}
  if (history !== undefined) {
    navigation.history = history
  }
  if (isServer !== undefined) {
    navigation.isServer = isServer
  }
  const router = createRouter({
    context: application,
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFoundPage,
    defaultPendingComponent: PendingPage,
    defaultPendingMs: 150,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    ...navigation,
    routeTree,
    scrollRestoration,
  })

  setupQuerySsr(router, application, options.preparation)

  if (router.isServer) {
    router.serverSsrLifecycle = {
      ...router.serverSsrLifecycle,
      onServerSsrAttach: [
        ...(router.serverSsrLifecycle?.onServerSsrAttach ?? []),
        (serverSsr) => {
          serverSsr.onCleanup(() => {
            void reportCleanupFailure(application.dispose())
          })
        },
      ],
    }
  } else {
    registerBrowserDisposal(application)
  }

  return router
}

const startApplication = createIsomorphicFn()
  .server(async () => startRequestApplication(getRequest()))
  .client(async () => startTanStackStartApplication({ rpcUrl: '/rpc' }))

export const getRouter = async () =>
  createTanStackStartRouter({ application: await startApplication() })

declare module '@tanstack/react-router' {
  interface Register {
    router: Awaited<ReturnType<typeof getRouter>>
  }
}
