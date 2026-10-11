// @vitest-environment jsdom

import type { DiagnosticStatus } from '@effect-api-query/contracts'
import { QueryClient } from '@tanstack/react-query'
import type { QueryFunctionContext } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { Deferred, Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { useSlowQueryCancellation } from '../../shared/use-slow-query-cancellation.ts'

interface SlowInput {
  readonly durationMs: number
  readonly operationId: string
}
interface StatusInput {
  readonly operationId: string
}
type Transport = 'rpc' | 'http'

const makeApplication = ({
  readStatus,
  isActive = () => true,
}: {
  readonly readStatus?: (status: DiagnosticStatus) => Effect.Effect<DiagnosticStatus>
  readonly isActive?: () => boolean
} = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const operations = new Map<string, DiagnosticStatus>()
  const statusSignals: AbortSignal[] = []
  const status = (operationId: string) =>
    operations.get(operationId) ?? { started: 0, interrupted: 0 }
  const slow = Effect.fnUntraced(function* ({ operationId }: SlowInput) {
    operations.set(operationId, { ...status(operationId), started: 1 })
    return yield* Effect.never.pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          operations.set(operationId, { ...status(operationId), interrupted: 1 })
        }),
      ),
    )
  })
  const slowQuery = (transport: Transport, input: SlowInput) => ({
    queryKey: [transport, 'slow', input.operationId],
    queryFn: async ({ signal }: QueryFunctionContext) => Effect.runPromise(slow(input), { signal }),
  })
  const statusQuery = (transport: Transport, { operationId }: StatusInput) => ({
    queryKey: [transport, 'status', operationId],
    queryFn: async ({ signal }: QueryFunctionContext) => {
      statusSignals.push(signal)
      const current = status(operationId)
      return Effect.runPromise(readStatus?.(current) ?? Effect.succeed(current), { signal })
    },
  })

  const application = {
    queryClient,
    isActive,
    rpcQuery: {
      diagnostics: {
        slow: {
          queryKey: (input: SlowInput) => slowQuery('rpc', input).queryKey,
          queryOptions: ({ input }: { readonly input: SlowInput }) => slowQuery('rpc', input),
        },
        operationStatus: {
          queryKey: (input: StatusInput) => statusQuery('rpc', input).queryKey,
          queryOptions: ({ input }: { readonly input: StatusInput }) => statusQuery('rpc', input),
        },
      },
    },
    httpQuery: {
      diagnostics: {
        slow: {
          queryKey: ({ query }: { readonly query: SlowInput }) => slowQuery('http', query).queryKey,
          queryOptions: ({ input }: { readonly input: { readonly query: SlowInput } }) =>
            slowQuery('http', input.query),
        },
        operationStatus: {
          queryKey: ({ params }: { readonly params: StatusInput }) =>
            statusQuery('http', params).queryKey,
          queryOptions: ({ input }: { readonly input: { readonly params: StatusInput } }) =>
            statusQuery('http', input.params),
        },
      },
    },
  }
  return { application, operations, statusSignals }
}

describe('shared slow-query cancellation lifetime', () => {
  afterEach(cleanup)

  it.each(['rpc', 'http'] as const)(
    'unmounting one %s hook interrupts only its operation',
    async (transport) => {
      const { application, operations } = makeApplication()
      const first = renderHook(() => useSlowQueryCancellation(application, transport))
      const second = renderHook(() => useSlowQueryCancellation(application, transport))
      try {
        await act(async () => {
          await Promise.all([first.result.current.start(), second.result.current.start()])
        })
        expect(first.result.current.canCancel).toBe(true)
        expect(second.result.current.canCancel).toBe(true)
        expect(operations.size).toBe(2)

        first.unmount()
        await waitFor(() => {
          expect(
            [...operations.values()].filter(({ interrupted }) => interrupted === 1),
          ).toHaveLength(1)
        })
        expect(application.queryClient.isFetching()).toBe(1)
        expect(second.result.current.canCancel).toBe(true)

        await act(async () => second.result.current.cancel())
        expect(second.result.current.state).toStrictEqual({ _tag: 'Cancelled', interruptions: 1 })
        expect(application.queryClient.isFetching()).toBe(0)
      } finally {
        first.unmount()
        second.unmount()
        await application.queryClient.cancelQueries()
        application.queryClient.clear()
      }
    },
  )

  it.each(['rpc', 'http'] as const)(
    'unmounting during the initial %s status request stops the request and prevents a slow query',
    async (transport) => {
      const { application, operations, statusSignals } = makeApplication({
        readStatus: () => Effect.never,
      })
      const hook = renderHook(() => useSlowQueryCancellation(application, transport))
      let starting: Promise<void> | undefined
      try {
        act(() => {
          starting = hook.result.current.start()
        })
        await waitFor(() => {
          expect(statusSignals).toHaveLength(1)
        })
        hook.unmount()
        await starting
        expect(statusSignals[0]?.aborted).toBe(true)
        expect(operations.size).toBe(0)
        expect(application.queryClient.isFetching()).toBe(0)
      } finally {
        hook.unmount()
        await application.queryClient.cancelQueries()
        application.queryClient.clear()
      }
    },
  )

  it('does not publish a completed status request or poll again after its owner retires', async () => {
    let active = true
    let statusReads = 0
    const release = Deferred.makeUnsafe<DiagnosticStatus>()
    const { application, operations } = makeApplication({
      isActive: () => active,
      readStatus: (status) => {
        statusReads += 1
        return statusReads === 1 ? Effect.succeed(status) : Deferred.await(release)
      },
    })
    const hook = renderHook(() => useSlowQueryCancellation(application))
    let starting: Promise<void> | undefined
    try {
      act(() => {
        starting = hook.result.current.start()
      })
      await waitFor(() => {
        expect(statusReads).toBe(2)
      })
      active = false
      await act(async () => {
        await Effect.runPromise(Deferred.succeed(release, { started: 1, interrupted: 0 }))
        await starting
      })
      expect(hook.result.current.canCancel).toBe(false)
      expect(hook.result.current.state).toStrictEqual({ _tag: 'Starting' })
      await act(async () => {
        await hook.result.current.start()
        await hook.result.current.cancel()
      })
      expect(statusReads).toBe(2)
      expect(operations.size).toBe(1)
    } finally {
      hook.unmount()
      await application.queryClient.cancelQueries()
      application.queryClient.clear()
    }
  })
})
