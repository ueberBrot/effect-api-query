// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Effect, Exit, Scope } from 'effect'
import { Suspense } from 'react'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { makeRpcTestClient } from '../../../tests/fixtures/effect-rpc.ts'
import {
  failureMessage,
  makeSuspenseQueries,
  suspenseGroup,
  TwoUsers,
  UserScreen,
  UserUnavailable,
} from '../../../tests/types/docs-suspense.tsx'
import type { Queries } from '../../../tests/types/docs-suspense.tsx'

const withUsers = async (
  read: (
    id: number,
  ) => Effect.Effect<{ readonly id: number; readonly name: string }, UserUnavailable>,
  run: (rpc: Queries<never>, queryClient: QueryClient) => Promise<void>,
) => {
  const scope = await Effect.runPromise(Scope.make())
  const queryClient = new QueryClient()
  try {
    const client = await Effect.runPromise(
      makeRpcTestClient(
        suspenseGroup,
        suspenseGroup.of({ 'users.get': ({ id }) => read(id) }),
      ).pipe(Scope.provide(scope)),
    )
    await run(makeSuspenseQueries(client), queryClient)
  } finally {
    cleanup()
    await queryClient.cancelQueries()
    queryClient.clear()
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
}

const controlledRead = (state: { unavailable: boolean }) => (id: number) =>
  Effect.suspend(() =>
    state.unavailable
      ? Effect.fail(new UserUnavailable({ message: 'Please try again later.' }))
      : Effect.succeed({ id, name: 'Ada' }),
  )

const renderUser = (rpc: Queries<never>, queryClient: QueryClient) =>
  render(
    <QueryClientProvider client={queryClient}>
      <UserScreen rpc={rpc} />
    </QueryClientProvider>,
  )

describe('Suspense recovery recipe', () => {
  afterEach(cleanup)

  it('retries an initial failure after the query and application boundaries reset', async () => {
    const state = { unavailable: true }
    await withUsers(controlledRead(state), async (rpc, queryClient) => {
      renderUser(rpc, queryClient)
      await expect(screen.findByRole('alert')).resolves.toHaveProperty(
        'textContent',
        'Please try again later.Try again',
      )
      state.unavailable = false
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await expect(screen.findByRole('heading', { name: 'Ada' })).resolves.toBeDefined()
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  it('keeps cached data visible after a failed background refresh', async () => {
    const state = { unavailable: false }
    await withUsers(controlledRead(state), async (rpc, queryClient) => {
      renderUser(rpc, queryClient)
      await expect(screen.findByRole('heading', { name: 'Ada' })).resolves.toBeDefined()
      state.unavailable = true
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      await expect(screen.findByRole('alert')).resolves.toHaveProperty(
        'textContent',
        'Please try again later.',
      )
      expect(screen.getByRole('heading', { name: 'Ada' })).toBeDefined()
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
      state.unavailable = false
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      await waitFor(() => {
        expect(screen.queryByRole('alert')).toBeNull()
      })
    })
  })

  it('starts independent queries before either Suspense request completes', async () => {
    const started = new Set<number>()
    await withUsers(
      (id) =>
        Effect.gen(function* () {
          started.add(id)
          while (started.size < 2) {
            yield* Effect.yieldNow
          }
          return { id, name: id === 1 ? 'Ada' : 'Grace' }
        }),
      async (rpc, queryClient) => {
        render(
          <QueryClientProvider client={queryClient}>
            <Suspense fallback={<p>Loading users…</p>}>
              <TwoUsers rpc={rpc} />
            </Suspense>
          </QueryClientProvider>,
        )
        await expect(screen.findByText('Ada and Grace')).resolves.toBeDefined()
      },
    )
  })

  it('uses a safe fallback for unknown errors', () => {
    expect(failureMessage(new Error('private transport details'))).toBe(
      'The request failed. Please try again.',
    )
  })
})
