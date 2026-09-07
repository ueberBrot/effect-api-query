import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { NavigationLink } from '../components/navigation-link.tsx'
import type { TanStackStartApplication } from '../lib/application.ts'

import stylesheet from '../styles.css?url'

export const Route = createRootRouteWithContext<TanStackStartApplication>()({
  component: Root,
  head: () => ({
    links: [{ href: stylesheet, rel: 'stylesheet' }],
    meta: [
      { charSet: 'utf-8' },
      { content: 'width=device-width, initial-scale=1', name: 'viewport' },
      { title: 'Effect API Query with TanStack Start' },
    ],
  }),
})

function Root() {
  return (
    <Document>
      <div className="app-backdrop grid min-h-screen grid-rows-[auto_1fr_auto] text-zinc-200">
        <header className="border-b border-zinc-800 bg-black/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <NavigationLink
              className="display-heading flex items-center gap-2 px-0 text-lg font-black tracking-tight text-zinc-100 normal-case hover:border-transparent hover:bg-transparent hover:text-violet-300"
              to="/"
            >
              <span aria-hidden="true" className="size-2 rounded-full bg-violet-600" />
              effect-api-query
            </NavigationLink>
            <nav aria-label="Primary">
              <ul className="flex flex-wrap gap-1 p-0">
                <li className="list-none">
                  <NavigationLink
                    activeProps={{
                      className: 'border-violet-800 bg-violet-950/60 text-violet-200',
                    }}
                    to="/"
                  >
                    Users
                  </NavigationLink>
                </li>
                <li className="list-none">
                  <NavigationLink
                    activeProps={{
                      className: 'border-violet-800 bg-violet-950/60 text-violet-200',
                    }}
                    to="/http"
                  >
                    HTTP users
                  </NavigationLink>
                </li>
                <li className="list-none">
                  <NavigationLink
                    activeProps={{
                      className: 'border-violet-800 bg-violet-950/60 text-violet-200',
                    }}
                    to="/http-failure"
                  >
                    HTTP SSR failure
                  </NavigationLink>
                </li>
                <li className="list-none">
                  <NavigationLink
                    activeProps={{
                      className: 'border-violet-800 bg-violet-950/60 text-violet-200',
                    }}
                    to="/details"
                  >
                    Featured user
                  </NavigationLink>
                </li>
                <li className="list-none">
                  <NavigationLink
                    activeProps={{
                      className: 'border-violet-800 bg-violet-950/60 text-violet-200',
                    }}
                    to="/diagnostics"
                  >
                    Diagnostics
                  </NavigationLink>
                </li>
                <li className="list-none">
                  <NavigationLink
                    activeProps={{
                      className: 'border-violet-800 bg-violet-950/60 text-violet-200',
                    }}
                    to="/failure"
                  >
                    SSR failure
                  </NavigationLink>
                </li>
              </ul>
            </nav>
          </div>
        </header>
        <Outlet />
        <footer className="mx-auto w-full max-w-7xl border-t border-zinc-900 px-4 py-6 text-sm text-zinc-500 sm:px-6">
          Generated Effect RPC and HTTP options with the TanStack Query lifecycle.
        </footer>
      </div>
    </Document>
  )
}

function Document({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="m-0 min-h-screen min-w-80 antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
