// @vitest-environment jsdom

import { CommandStatus } from '@effect-api-query/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { makeControlledUserWrites } from '../../../tests/fixtures/optimistic-users.ts'
import { CommandsSection } from '../src/components/sections/commands-section.tsx'

describe('Cancellable command recovery', () => {
  afterEach(cleanup)

  it('stops polling a rejected command and retries with its original operation ID', async () => {
    const starts: string[] = []
    let command: CommandStatus | null = null
    const readStatus = vi.fn<() => Effect.Effect<CommandStatus | null>>(() =>
      Effect.succeed(command),
    )
    const fixture = await Effect.runPromise(
      makeControlledUserWrites(new QueryClient({ defaultOptions: { queries: { retry: false } } }), {
        start: ({ operationId, steps }) => {
          starts.push(operationId)
          if (starts.length === 1) {
            return Effect.interrupt
          }
          command = new CommandStatus({
            operationId,
            state: 'completed',
            completedSteps: steps,
            totalSteps: steps,
          })
          return Effect.succeed(command)
        },
        status: readStatus,
      }),
    )
    try {
      const view = render(
        <QueryClientProvider client={fixture.application.queryClient}>
          <CommandsSection application={fixture.application} />
        </QueryClientProvider>,
      )
      const first = within(view.getByRole('region', { name: 'Command 1' }))
      fireEvent.click(first.getByRole('button', { name: 'Start command' }))
      await expect(first.findByText('Start mutation: error')).resolves.toBeDefined()
      await vi.waitFor(() => {
        expect(first.getByRole('button', { name: 'Start command' }).hasAttribute('disabled')).toBe(
          false,
        )
        expect(
          fixture.application.queryClient.getQueryState(
            fixture.application.rpcQuery.commands.status.queryKey({ operationId: starts[0] ?? '' }),
          ),
        ).toMatchObject({ status: 'success', data: null, fetchStatus: 'idle' })
      })
      const reads = readStatus.mock.calls.length
      await Effect.runPromise(Effect.sleep('250 millis'))
      expect(readStatus).toHaveBeenCalledTimes(reads)
      fireEvent.click(first.getByRole('button', { name: 'Start command' }))
      await expect(first.findByText('Server state: completed')).resolves.toBeDefined()
      expect(starts).toHaveLength(2)
      expect(starts[1]).toBe(starts[0])
    } finally {
      cleanup()
      await fixture.application.dispose()
    }
  })

  it('continues reconciling accepted work after the start response fails', async () => {
    let command: CommandStatus | null = null
    let reads = 0
    let failedReads = 0
    const fixture = await Effect.runPromise(
      makeControlledUserWrites(new QueryClient({ defaultOptions: { queries: { retry: false } } }), {
        start: ({ operationId, steps }) => {
          command = new CommandStatus({
            operationId,
            state: 'running',
            completedSteps: 1,
            totalSteps: steps,
          })
          return Effect.interrupt
        },
        status: () => {
          if (command !== null && failedReads === 0) {
            failedReads += 1
            return Effect.interrupt
          }
          reads += 1
          if (command !== null && reads >= 3) {
            command = new CommandStatus({
              operationId: command.operationId,
              totalSteps: command.totalSteps,
              state: 'completed',
              completedSteps: command.totalSteps,
            })
          }
          return Effect.succeed(command)
        },
      }),
    )
    try {
      const view = render(
        <QueryClientProvider client={fixture.application.queryClient}>
          <CommandsSection application={fixture.application} />
        </QueryClientProvider>,
      )
      const first = within(view.getByRole('region', { name: 'Command 1' }))
      fireEvent.click(first.getByRole('button', { name: 'Start command' }))
      await expect(first.findByText('Start mutation: error')).resolves.toBeDefined()
      await expect(first.findByText('Server state: completed')).resolves.toBeDefined()
      expect(reads).toBeGreaterThanOrEqual(3)
      expect(failedReads).toBe(1)
      expect(first.getByRole('button', { name: 'Start command' }).hasAttribute('disabled')).toBe(
        true,
      )
    } finally {
      cleanup()
      await fixture.application.dispose()
    }
  })
})
