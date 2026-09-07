import { createRouter, type RouterHistory } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'

import { ErrorPage, NotFoundPage, PendingPage } from './components/router-status.tsx'
import { startTanStackStartApplication, type TanStackStartApplication } from './lib/application.ts'
import { setupQuerySsr } from './lib/query-ssr.ts'
import { routeTree } from './routeTree.gen.ts'

export interface RouterOptions {
  readonly history?: RouterHistory
  readonly isServer?: boolean
  readonly scrollRestoration?: boolean
}

export type CreateTanStackStartRouterOptions = RouterOptions &
  (
    | { readonly application: TanStackStartApplication; readonly rpcUrl?: never }
    | { readonly application?: never; readonly rpcUrl: string }
  )

const registerBrowserDisposal = (application: TanStackStartApplication): void => {
  if (typeof window === 'undefined') return
  const dispose = () => void application.dispose()
  window.addEventListener('pagehide', dispose, { once: true })
}

export const createTanStackStartRouter = async (options: CreateTanStackStartRouterOptions) => {
  const { history, isServer, scrollRestoration = true } = options
  const application =
    options.application ?? (await startTanStackStartApplication({ rpcUrl: options.rpcUrl }))
  const router = createRouter({
    context: application,
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFoundPage,
    defaultPendingComponent: PendingPage,
    defaultPendingMs: 150,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    ...(history === undefined ? {} : { history }),
    ...(isServer === undefined ? {} : { isServer }),
    routeTree,
    scrollRestoration,
  })

  setupQuerySsr(router, application.queryClient)

  if (router.isServer) {
    router.serverSsrLifecycle = {
      ...router.serverSsrLifecycle,
      onServerSsrAttach: [
        ...(router.serverSsrLifecycle?.onServerSsrAttach ?? []),
        (serverSsr) => serverSsr.onCleanup(() => void application.dispose()),
      ],
    }
  } else {
    registerBrowserDisposal(application)
  }

  return router
}

const rpcUrl = createIsomorphicFn()
  .server(() => {
    const origin = new URL(process.env['EXAMPLE_API_ORIGIN'] ?? 'http://127.0.0.1:3000')
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username !== '' ||
      origin.password !== '' ||
      origin.pathname !== '/' ||
      origin.search !== '' ||
      origin.hash !== ''
    ) {
      throw new Error('EXAMPLE_API_ORIGIN must be an HTTP(S) origin without credentials')
    }
    return new URL('/rpc', origin).href
  })
  .client(() => '/rpc')

export const getRouter = () => createTanStackStartRouter({ rpcUrl: rpcUrl() })

declare module '@tanstack/react-router' {
  interface Register {
    router: Awaited<ReturnType<typeof getRouter>>
  }
}
