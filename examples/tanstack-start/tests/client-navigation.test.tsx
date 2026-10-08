// @vitest-environment jsdom

import { startExampleRpcServer } from '@effect-api-query/server'
import { dehydrate } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Effect, Exit, Scope } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'

import { startTanStackStartApplication } from '../src/lib/application.ts'
import type { TanStackStartApplication } from '../src/lib/application.ts'
import { createTanStackStartRouter } from '../src/router.tsx'

describe('TanStack Start hydration and client navigation', () => {
  let browserApplication: TanStackStartApplication | undefined
  let serverApplication: TanStackStartApplication | undefined
  let serverScope: Scope.Closeable | undefined

  beforeEach(async () => {
    window.scrollTo = () => {}
    serverScope = await Effect.runPromise(Scope.make())
  })

  afterEach(async () => {
    cleanup()
    await browserApplication?.dispose()
    await serverApplication?.dispose()
    if (serverScope !== undefined) {
      await Effect.runPromise(Scope.close(serverScope, Exit.void))
    }
  })

  // Hydration, streaming, two navigations, and a mutation share the test deadline.
  it('hydrates without a duplicate query, navigates, mutates, and invalidates', async () => {
    if (serverScope === undefined) {
      throw new Error('Server scope was not initialized')
    }
    const server = await Effect.runPromise(startExampleRpcServer().pipe(Scope.provide(serverScope)))
    serverApplication = await startTanStackStartApplication({ rpcUrl: server.rpcUrl })
    const serverOptions = serverApplication.rpcQuery.users.list.queryOptions()
    await serverApplication.queryClient.query({ ...serverOptions, staleTime: 'static' })

    browserApplication = await startTanStackStartApplication({ rpcUrl: server.rpcUrl })
    const router = await createTanStackStartRouter({
      application: browserApplication,
      history: createMemoryHistory({ initialEntries: ['/'] }),
      scrollRestoration: false,
    })
    await router.options.hydrate?.({
      query: {
        initial: dehydrate(serverApplication.queryClient).queries,
        stream: new ReadableStream({
          start: (controller) => {
            controller.close()
          },
        }),
      },
    })
    let duplicateListFetches = 0
    const unsubscribe = browserApplication.queryClient.getQueryCache().subscribe((event) => {
      if (
        event.query.queryHash ===
          browserApplication?.queryClient.getQueryCache().find(serverOptions)?.queryHash &&
        event.query.state.fetchStatus === 'fetching'
      ) {
        duplicateListFetches += 1
      }
    })
    await router.load()
    render(<RouterProvider router={router} />)

    await expect(screen.findByText('Ada Lovelace')).resolves.toBeDefined()
    expect(duplicateListFetches).toBe(0)
    await expect(screen.findByText('4 of 12 loaded')).resolves.toBeDefined()
    await expect(screen.findByText('Page 1: 4 users')).resolves.toBeDefined()
    await expect(
      screen.findByText('4 updates retained', undefined, { timeout: 3000 }),
    ).resolves.toBeDefined()
    await expect(screen.findByText('Current state: Ready')).resolves.toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Load next 4 users' }))
    await expect(screen.findByText('Page 2: 4 users')).resolves.toBeDefined()
    await expect(screen.findByText('8 of 12 loaded')).resolves.toBeDefined()

    await act(async () => router.navigate({ to: '/details' }))
    await expect(screen.findByRole('heading', { name: 'Featured user' })).resolves.toBeDefined()
    await expect(screen.findByText('Ada Lovelace')).resolves.toBeDefined()

    await act(async () => router.navigate({ to: '/' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add Grace Hopper' }, { timeout: 4000 }),
    )
    await expect(screen.findByText('Grace Hopper')).resolves.toBeDefined()
    await expect(screen.findByText('13 users in one response')).resolves.toBeDefined()

    unsubscribe()
  }, 15_000)

  it('shows declared failures, cancels queries, and renders the default 404', async () => {
    if (serverScope === undefined) {
      throw new Error('Server scope was not initialized')
    }
    const server = await Effect.runPromise(startExampleRpcServer().pipe(Scope.provide(serverScope)))
    const router = await createTanStackStartRouter({
      history: createMemoryHistory({ initialEntries: ['/diagnostics'] }),
      rpcUrl: server.rpcUrl,
      scrollRestoration: false,
    })
    browserApplication = router.options.context

    await router.load()
    render(<RouterProvider router={router} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Trigger declared failure' }))
    const failure = await screen.findByRole('alert')
    expect(failure.textContent).toContain('EffectRpcQueryError')
    expect(failure.textContent).toContain('DiagnosticFailure')

    fireEvent.click(screen.getByRole('button', { name: 'Start slow query' }))
    await expect(screen.findByText('Ready to cancel')).resolves.toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel query' }))
    await expect(screen.findByText('Server interruptions: 1')).resolves.toBeDefined()

    await act(async () => router.navigate({ to: '/failure' }))
    const refetchedFailure = await screen.findByRole('alert')
    expect(refetchedFailure.textContent).toContain('DiagnosticFailure')

    await act(async () => {
      router.history.push('/missing')
      await router.load()
    })
    await expect(screen.findByRole('heading', { name: 'Page not found' })).resolves.toBeDefined()
  })
})
