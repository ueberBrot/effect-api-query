import { startExampleRpcServer } from '@effect-api-query/server'
import { MutationObserver, QueryObserver } from '@tanstack/react-query'
import { Effect, Exit, Scope } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { startViteReactApplication } from '../src/lib/application.ts'
import type { ViteReactApplication } from '../src/lib/application.ts'

describe('Cancellable commands', () => {
  it('drains an accepted command before replacing its owner and preserves completed work', async () => {
    const serverScope = await Effect.runPromise(Scope.make())
    let previous: ViteReactApplication | undefined
    let current: ViteReactApplication | undefined
    try {
      const server = await Effect.runPromise(
        startExampleRpcServer().pipe(Scope.provide(serverScope)),
      )
      previous = await startViteReactApplication({ rpcUrl: server.rpcUrl })
      const captured = previous
      const input = { operationId: 'owner-handoff', steps: 10 }
      const start = new MutationObserver(
        captured.queryClient,
        captured.trackMutationOptions(
          captured.rpcQuery.commands.start.mutationOptions({
            onSettled: async () => {
              if (captured.isActive()) {
                await captured.queryClient.invalidateQueries({
                  queryKey: captured.rpcQuery.commands.status.queryKey(input),
                })
              }
            },
          }),
        ),
      )
      const accepted = start.mutate(input)
      const statusOptions = captured.rpcQuery.commands.status.queryOptions({ input })
      await expect
        .poll(async () => {
          const status = await captured.queryClient.query(statusOptions)
          return status?.completedSteps ?? 0
        })
        .toBeGreaterThan(0)
      expect(captured.queryClient.getQueryData(statusOptions.queryKey)?.state).toBe('running')
      expect(start.getCurrentResult().status).toBe('pending')

      const retiring = captured.dispose()
      expect(captured.isActive()).toBe(false)
      const completed = await accepted
      await retiring
      expect(completed).toMatchObject({
        operationId: 'owner-handoff',
        state: 'completed',
        completedSteps: 10,
        totalSteps: 10,
      })
      expect(start.getCurrentResult().status).toBe('success')
      expect(captured.queryClient.getQueryCache().getAll()).toHaveLength(0)
      expect(captured.queryClient.getMutationCache().getAll()).toHaveLength(0)

      current = await startViteReactApplication({
        rpcUrl: server.rpcUrl,
        identity: { ...captured.identity, permissionGeneration: 2 },
      })
      const replacementStart = new MutationObserver(
        current.queryClient,
        current.trackMutationOptions(current.rpcQuery.commands.start.mutationOptions()),
      )
      expect(replacementStart.getCurrentResult().status).toBe('idle')
      expect(current.queryClient.getMutationCache().getAll()).toHaveLength(0)
      await expect(
        current.queryClient.query(current.rpcQuery.commands.status.queryOptions({ input })),
      ).resolves.toStrictEqual(completed)
    } finally {
      await previous?.dispose()
      await current?.dispose()
      await Effect.runPromise(Scope.close(serverScope, Exit.void))
    }
  })

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
