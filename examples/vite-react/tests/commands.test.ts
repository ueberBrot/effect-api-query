import { startExampleRpcServer } from '@effect-api-query/server'
import { MutationObserver, QueryObserver } from '@tanstack/react-query'
import { Effect, Exit, Scope } from 'effect'
import { expect, it } from 'vitest'

import { startViteReactApplication } from '../src/lib/application.ts'

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
  const unsubscribe = observer.subscribe(() => undefined)
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
    expect(queryClient.getQueryData(statusOptions.queryKey)).toEqual(cancelled)
    expect(await firstResult).toEqual(cancelled)
    expect(first.getCurrentResult().status).toBe('success')
    expect(events).toEqual(['success', 'settled'])
    expect(await secondResult).toMatchObject({
      operationId: 'second',
      state: 'completed',
      completedSteps: 10,
    })
    expect(await queryClient.fetchQuery({ ...statusOptions, staleTime: 0 })).toEqual(cancelled)
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
    expect(
      await queryClient.fetchQuery(rpcQuery.commands.status.queryOptions({ input })),
    ).toBeNull()
    const cancelled = await cancel.mutate(input)
    expect(cancelled).toMatchObject({ state: 'cancelled', completedSteps: 0 })
    expect(await start.mutate(input)).toEqual(cancelled)
    expect(await cancel.mutate(input)).toEqual(cancelled)

    const reset = new MutationObserver(queryClient, rpcQuery.testing.reset.mutationOptions())
    await reset.mutate(undefined)
    const [completed, duplicate] = await Promise.all([start.mutate(input), start.mutate(input)])
    expect(completed).toMatchObject({ state: 'completed', completedSteps: 2, totalSteps: 2 })
    expect(duplicate).toEqual(completed)
    expect(await cancel.mutate(input)).toEqual(completed)
    expect(await start.mutate({ ...input, steps: 100 })).toEqual(completed)
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
      .poll(async () => (await queryClient.fetchQuery(options))?.completedSteps ?? 0)
      .toBeGreaterThan(0)
    const reset = new MutationObserver(queryClient, rpcQuery.testing.reset.mutationOptions())
    await reset.mutate(undefined)
    expect(await running).toMatchObject({ state: 'cancelled', totalSteps: 40 })
    expect(await queryClient.fetchQuery(options)).toBeNull()
    expect(await start.mutate({ ...input, steps: 1 })).toMatchObject({
      state: 'completed',
      completedSteps: 1,
    })
  } finally {
    await application.dispose()
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})
