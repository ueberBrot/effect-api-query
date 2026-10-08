import { startExampleRpcServer } from '@effect-api-query/server'
import { MutationObserver, QueryObserver } from '@tanstack/react-query'
import { Effect, Exit, Scope } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { startViteReactApplication } from '../src/lib/application.ts'

describe('Cancellable commands', () => {
  it('cancels a pending command, reconciles cached progress, and isolates another command', async () => {
    const scope = await Effect.runPromise(Scope.make())
    const server = await Effect.runPromise(startExampleRpcServer().pipe(Scope.provide(scope)))
    const application = await startViteReactApplication({ rpcUrl: server.rpcUrl })
    const { queryClient, rpcQuery } = application
    const firstInput = { operationId: 'first', steps: 40 }
    const secondInput = { operationId: 'second', steps: 10 }
    const statusOptions = rpcQuery.commands.status.queryOptions({
      input: firstInput,
      staleTime: Infinity,
    })
    const observer = new QueryObserver(queryClient, statusOptions)
    const unsubscribe = observer.subscribe(() => {})
    const events: string[] = []
    const first = new MutationObserver(
      queryClient,
      rpcQuery.commands.start.mutationOptions({
        onSuccess: () => {
          events.push('success')
        },
        onSettled: () => {
          events.push('settled')
        },
      }),
    )
    const second = new MutationObserver(queryClient, rpcQuery.commands.start.mutationOptions())
    try {
      const firstResult = first.mutate(firstInput)
      const secondResult = second.mutate(secondInput)
      await expect
        .poll(async () => {
          await queryClient.invalidateQueries({ queryKey: statusOptions.queryKey })
          return queryClient.getQueryData(statusOptions.queryKey)?.completedSteps ?? 0
        })
        .toBeGreaterThan(0)
      expect(first.getCurrentResult().status).toBe('pending')
      const cancel = new MutationObserver(
        queryClient,
        rpcQuery.commands.cancel.mutationOptions({
          onSettled: async () => {
            await queryClient.invalidateQueries({
              queryKey: rpcQuery.commands.status.queryKey(firstInput),
            })
          },
        }),
      )
      const cancelled = await cancel.mutate(firstInput)
      expect(cancelled.state).toBe('cancelled')
      expect(cancelled.completedSteps).toBeLessThan(40)
      expect(queryClient.getQueryData(statusOptions.queryKey)).toStrictEqual(cancelled)
      await expect(firstResult).resolves.toStrictEqual(cancelled)
      expect(first.getCurrentResult().status).toBe('success')
      expect(events).toStrictEqual(['success', 'settled'])
      await expect(secondResult).resolves.toMatchObject({
        operationId: 'second',
        state: 'completed',
        completedSteps: 10,
      })
      await expect(queryClient.query({ ...statusOptions, staleTime: 0 })).resolves.toStrictEqual(
        cancelled,
      )
    } finally {
      unsubscribe()
      await application.dispose()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })

  it('keeps command IDs idempotent across early cancellation, completion, and reset', async () => {
    const scope = await Effect.runPromise(Scope.make())
    const server = await Effect.runPromise(startExampleRpcServer().pipe(Scope.provide(scope)))
    const application = await startViteReactApplication({ rpcUrl: server.rpcUrl })
    const { queryClient, rpcQuery } = application
    const start = new MutationObserver(queryClient, rpcQuery.commands.start.mutationOptions())
    const cancel = new MutationObserver(queryClient, rpcQuery.commands.cancel.mutationOptions())
    const input = { operationId: 'repeat', steps: 2 }
    try {
      await expect(
        queryClient.query(rpcQuery.commands.status.queryOptions({ input })),
      ).resolves.toBeNull()
      const cancelled = await cancel.mutate(input)
      expect(cancelled).toMatchObject({ state: 'cancelled', completedSteps: 0 })
      await expect(start.mutate(input)).resolves.toStrictEqual(cancelled)
      await expect(cancel.mutate(input)).resolves.toStrictEqual(cancelled)

      const reset = new MutationObserver(queryClient, rpcQuery.testing.reset.mutationOptions())
      await reset.mutate()
      const [completed, duplicate] = await Promise.all([start.mutate(input), start.mutate(input)])
      expect(completed).toMatchObject({ state: 'completed', completedSteps: 2, totalSteps: 2 })
      expect(duplicate).toStrictEqual(completed)
      await expect(cancel.mutate(input)).resolves.toStrictEqual(completed)
      await expect(start.mutate({ ...input, steps: 100 })).resolves.toStrictEqual(completed)
    } finally {
      await application.dispose()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })

  it('resets running commands before allowing their operation IDs to be reused', async () => {
    const scope = await Effect.runPromise(Scope.make())
    const server = await Effect.runPromise(startExampleRpcServer().pipe(Scope.provide(scope)))
    const application = await startViteReactApplication({ rpcUrl: server.rpcUrl })
    const { queryClient, rpcQuery } = application
    const input = { operationId: 'reset-running' }
    const options = rpcQuery.commands.status.queryOptions({ input })
    try {
      const start = new MutationObserver(queryClient, rpcQuery.commands.start.mutationOptions())
      const running = start.mutate(input)
      await expect
        .poll(async () => {
          const status = await queryClient.query(options)
          return status?.completedSteps ?? 0
        })
        .toBeGreaterThan(0)
      const reset = new MutationObserver(queryClient, rpcQuery.testing.reset.mutationOptions())
      await reset.mutate()
      await expect(running).resolves.toMatchObject({ state: 'cancelled', totalSteps: 40 })
      await expect(queryClient.query(options)).resolves.toBeNull()
      await expect(start.mutate({ ...input, steps: 1 })).resolves.toMatchObject({
        state: 'completed',
        completedSteps: 1,
      })
    } finally {
      await application.dispose()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })
})
