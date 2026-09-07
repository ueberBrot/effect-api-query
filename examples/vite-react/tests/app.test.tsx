// @vitest-environment jsdom

import { startExampleRpcServer } from '@effect-api-query/server'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Effect, Exit, Scope } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ViteReactExample } from '../src/App.tsx'
import { startViteReactApplication, type ViteReactApplication } from '../src/lib/application.ts'

describe('plain Vite React integration', () => {
  let application: ViteReactApplication | undefined
  let serverScope: Scope.Closeable | undefined

  beforeEach(async () => {
    serverScope = await Effect.runPromise(Scope.make())
    const server = await Effect.runPromise(startExampleRpcServer().pipe(Scope.provide(serverScope)))
    application = await startViteReactApplication({ rpcUrl: server.rpcUrl })
    render(<ViteReactExample application={application} />)
  })

  afterEach(async () => {
    cleanup()
    await application?.dispose()
    if (serverScope !== undefined) {
      await Effect.runPromise(Scope.close(serverScope, Exit.void))
    }
  })

  it('uses generated options with ordinary, suspense, and mutation hooks', async () => {
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()
    expect(await screen.findByText('Featured: Ada Lovelace')).toBeTruthy()
    expect(await screen.findByText('4 of 12 loaded')).toBeTruthy()
    expect(await screen.findByText('Page 1: 4 users')).toBeTruthy()
    expect(
      await screen.findByText('4 updates retained', undefined, { timeout: 3_000 }),
    ).toBeTruthy()
    expect(await screen.findByText('Current state: Ready')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Load next 4 users' }))
    expect(await screen.findByText('Page 2: 4 users')).toBeTruthy()
    expect(await screen.findByText('8 of 12 loaded')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Read cached directory' }))
    expect(await screen.findByText('Cached directory: 12 users')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Run void query' }))
    expect(await screen.findByText('Void query result: null')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Reset directory' }))
    expect(await screen.findByText('Reset result: undefined')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Trigger declared failure' }))
    const failure = await screen.findByRole('alert')
    expect(failure.textContent).toContain('EffectRpcQueryError')
    expect(failure.textContent).toContain('diagnostics.fail')
    expect(failure.textContent).toContain('DiagnosticFailure')
  })

  it('seeds and invalidates user queries through generated keys', async () => {
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Replace with eight pioneers' }))
    expect(await screen.findByText('Grace Hopper')).toBeTruthy()
    expect(screen.getByText('Margaret Hamilton')).toBeTruthy()
    expect(await screen.findByText('8 users in one response')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Invalidate user queries' }))
    expect(await screen.findByText('Directory queries invalidated and refetched')).toBeTruthy()
  })

  it('adds the user details submitted through the form', async () => {
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Katherine Johnson' },
    })
    fireEvent.change(screen.getByLabelText('Locale (optional)'), {
      target: { value: 'fr' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }))

    expect(await screen.findByText('Added Katherine Johnson')).toBeTruthy()
    expect(await screen.findByText('Katherine Johnson')).toBeTruthy()
    expect(screen.getByText('User 13, locale fr')).toBeTruthy()
  })

  it('deletes the user selected from the rendered list', async () => {
    expect(await screen.findByText('Edsger Dijkstra')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Edsger Dijkstra' }))

    await waitFor(() => {
      expect(screen.queryByText('Edsger Dijkstra')).toBeNull()
    })
  })

  it('cancels a started slow query and observes server-side interruption', async () => {
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Start slow query' }))
    expect(await screen.findByText('Ready to cancel')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel query' }))
    expect(await screen.findByText('Server interruptions: 1')).toBeTruthy()
  })

  it('uses HTTP request parts, skipToken, pages, and shared directory invalidation', async () => {
    expect(await screen.findByText('HTTP: Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('HTTP user query skipped')).toBeTruthy()
    expect(await screen.findByText('HTTP: 4 of 12 loaded')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('HTTP user details'), { target: { value: '1' } })
    expect(await screen.findByText('HTTP selected: Ada Lovelace, locale fr')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load next HTTP page' }))
    expect(await screen.findByText('HTTP page 2: 4 users')).toBeTruthy()
    expect(await screen.findByText('HTTP: 8 of 12 loaded')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Read cached HTTP directory' }))
    expect(await screen.findByText('HTTP cached directory: 12 users')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('HTTP name'), {
      target: { value: 'Karen Spärck Jones' },
    })
    fireEvent.change(screen.getByLabelText('HTTP locale (optional)'), { target: { value: 'de' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add HTTP user' }))
    expect(await screen.findByText('HTTP added Karen Spärck Jones')).toBeTruthy()
    expect(await screen.findByText('HTTP: Karen Spärck Jones')).toBeTruthy()
    expect(await screen.findByText('Karen Spärck Jones')).toBeTruthy()
    expect(screen.getByText('User 13, locale de')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete HTTP Karen Spärck Jones' }))
    expect(await screen.findByText('HTTP delete result: undefined')).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByText('HTTP: Karen Spärck Jones')).toBeNull()
      expect(screen.queryByText('Karen Spärck Jones')).toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Replace with eight pioneers' }))
    expect(await screen.findByText('HTTP: Margaret Hamilton')).toBeTruthy()
    expect(await screen.findByText('HTTP directory: 8 users')).toBeTruthy()
  })

  it('preserves the HTTP declared failure and cancels the server request', async () => {
    expect(await screen.findByText('HTTP: Ada Lovelace')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Trigger HTTP declared failure' }))
    const failure = await screen.findByRole('alert')
    expect(failure.textContent).toContain('EffectHttpApiQueryError')
    expect(failure.textContent).toContain('diagnostics.fail')
    expect(failure.textContent).toContain('DiagnosticFailure')

    fireEvent.click(screen.getByRole('button', { name: 'Start slow HTTP query' }))
    expect(await screen.findByText('HTTP: Ready to cancel')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel HTTP query' }))
    expect(await screen.findByText('HTTP: Server interruptions: 1')).toBeTruthy()
  })

  it('cancels simultaneous RPC and HTTP queries independently', async () => {
    expect(await screen.findByText('HTTP: Ada Lovelace')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start slow query' }))
    expect(await screen.findByText('Ready to cancel', { exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start slow HTTP query' }))
    expect(await screen.findByText('HTTP: Ready to cancel')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel query' }))
    expect(await screen.findByText('Server interruptions: 1', { exact: true })).toBeTruthy()
    expect(
      application?.queryClient.isFetching({
        queryKey: application.httpQuery.diagnostics.slow.key(),
      }),
    ).toBe(1)
    expect(screen.getByText('HTTP: Ready to cancel')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel HTTP query' }))
    expect(await screen.findByText('HTTP: Server interruptions: 1')).toBeTruthy()
    expect(
      application?.queryClient.isFetching({
        queryKey: application.httpQuery.diagnostics.slow.key(),
      }),
    ).toBe(0)
  })

  it('disposes its client Scope and runtime idempotently', async () => {
    const ownedApplication = application
    expect(ownedApplication).toBeDefined()
    cleanup()
    await Promise.all([ownedApplication?.dispose(), ownedApplication?.dispose()])

    await waitFor(() => {
      expect(ownedApplication?.queryClient.isFetching()).toBe(0)
    })
  })
})
