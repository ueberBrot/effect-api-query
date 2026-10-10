// @vitest-environment jsdom

import type { CommandStatus } from '@effect-api-query/contracts'
import { startExampleRpcServer } from '@effect-api-query/server'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Effect, Exit, Scope } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'

import { ViteReactExample } from '../src/app.tsx'
import { startViteReactApplication } from '../src/lib/application.ts'
import type { ViteReactApplication } from '../src/lib/application.ts'

describe('React consumers at the application owner boundary', () => {
  it('remounts a pending mutation observer when the permission generation changes', async () => {
    const serverScope = await Effect.runPromise(Scope.make())
    let previous: ViteReactApplication | undefined
    let current: ViteReactApplication | undefined
    try {
      const server = await Effect.runPromise(
        startExampleRpcServer().pipe(Scope.provide(serverScope)),
      )
      previous = await startViteReactApplication({ rpcUrl: server.rpcUrl })
      const view = render(<ViteReactExample application={previous} />)
      const first = screen.getByRole('region', { name: 'Command 1' })
      fireEvent.click(within(first).getByRole('button', { name: 'Start command' }))
      await expect(within(first).findByText('Server state: running')).resolves.toBeDefined()
      const [status] = previous.queryClient
        .getQueriesData<CommandStatus | null>({ queryKey: previous.rpcQuery.commands.status.key() })
        .map(([, data]) => data)
      expect(status?.operationId).toBeDefined()
      if (status === undefined || status === null) {
        throw new Error('Expected the started command status')
      }
      current = await startViteReactApplication({
        rpcUrl: server.rpcUrl,
        identity: { ...previous.identity, permissionGeneration: 2 },
      })
      view.rerender(<ViteReactExample application={current} />)
      expect(screen.getAllByText('Start mutation: idle')).toHaveLength(2)
      expect(screen.getAllByText('Server state: not started')).toHaveLength(2)
      const capturedCurrent = current
      await vi.waitFor(() => {
        expect(
          capturedCurrent.queryClient.getQueryData(capturedCurrent.rpcQuery.users.list.queryKey()),
        ).toBeDefined()
      })
      await current.rpcQuery.commands.cancel
        .mutationOptions()
        .mutationFn({ operationId: status.operationId })
      await previous.dispose()
      expect(previous.queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(current.queryClient.getMutationCache().getAll()).toHaveLength(0)
    } finally {
      cleanup()
      await previous?.dispose()
      await current?.dispose()
      await Effect.runPromise(Scope.close(serverScope, Exit.void))
    }
  })
})
