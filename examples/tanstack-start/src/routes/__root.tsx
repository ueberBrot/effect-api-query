import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { NavigationLink } from '../components/navigation-link.tsx'
import type { TanStackStartApplication } from '../lib/application.ts'

import stylesheet from '../styles.css?url'

const Root = () => (
  <Document>
    <div className="app-backdrop grid min-h-screen grid-rows-[auto_1fr_auto] text-text-secondary">
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <NavigationLink to="/" variant="brand">
            <span aria-hidden="true" className="size-2 rounded-full bg-brand-600" />
            effect-api-query
          </NavigationLink>
          <nav aria-label="Primary">
            <ul className="flex flex-wrap gap-1 p-0">
              <li className="list-none">
                <NavigationLink
                  activeProps={{
                    className: 'border-brand-800 bg-brand-950/60 text-brand-200',
                  }}
                  to="/"
                >
                  Users
                </NavigationLink>
              </li>
              <li className="list-none">
                <NavigationLink
                  activeProps={{
                    className: 'border-brand-800 bg-brand-950/60 text-brand-200',
                  }}
                  to="/http"
                >
                  HTTP users
                </NavigationLink>
              </li>
              <li className="list-none">
                <NavigationLink
                  activeProps={{
                    className: 'border-brand-800 bg-brand-950/60 text-brand-200',
                  }}
                  to="/http-failure"
                >
                  HTTP SSR failure
                </NavigationLink>
              </li>
              <li className="list-none">
                <NavigationLink
                  activeProps={{
                    className: 'border-brand-800 bg-brand-950/60 text-brand-200',
                  }}
                  to="/details"
                >
                  Featured user
                </NavigationLink>
              </li>
              <li className="list-none">
                <NavigationLink
                  activeProps={{
                    className: 'border-brand-800 bg-brand-950/60 text-brand-200',
                  }}
                  to="/diagnostics"
                >
                  Diagnostics
                </NavigationLink>
              </li>
              <li className="list-none">
                <NavigationLink
                  activeProps={{
                    className: 'border-brand-800 bg-brand-950/60 text-brand-200',
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
      <footer className="mx-auto w-full max-w-7xl border-t border-border-subtle px-4 py-6 text-sm text-text-subtle sm:px-6">
        Generated Effect RPC and HTTP options with the TanStack Query lifecycle.
      </footer>
    </div>
  </Document>
)

const Document = ({ children }: { readonly children: ReactNode }) => (
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
