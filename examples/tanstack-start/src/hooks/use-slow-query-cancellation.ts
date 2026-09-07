import type { DiagnosticStatus } from '@effect-api-query/contracts'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { TanStackStartApplication } from '../lib/application.ts'

// Browser workflow shared by both transports.
export type SlowQueryCancellationState =
  | { readonly _tag: 'Idle' }
  | { readonly _tag: 'Starting' }
  | { readonly _tag: 'Ready' }
  | { readonly _tag: 'Cancelling' }
  | { readonly _tag: 'Cancelled'; readonly interruptions: number }
  | { readonly _tag: 'Failed'; readonly error: unknown }

export const describeSlowQueryCancellation = (
  state: SlowQueryCancellationState,
): string | undefined => {
  switch (state._tag) {
    case 'Idle':
      return undefined
    case 'Starting':
      return 'Starting query…'
    case 'Ready':
      return 'Ready to cancel'
    case 'Cancelling':
      return 'Cancelling query…'
    case 'Cancelled':
      return `Server interruptions: ${String(state.interruptions)}`
    case 'Failed':
      return 'Slow query failed'
  }
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds)
  })

/** Coordinates typed diagnostic operations as one cancellation demonstration. */
export const useSlowQueryCancellation = (
  { queryClient, rpcQuery, httpQuery }: TanStackStartApplication,
  transport: 'rpc' | 'http' = 'rpc',
) => {
  const [state, setState] = useState<SlowQueryCancellationState>({ _tag: 'Idle' })
  const baseline = useRef<DiagnosticStatus | undefined>(undefined)
  const [slowInput] = useState(() => ({
    durationMs: 60_000,
    operationId: globalThis.crypto.randomUUID(),
  }))
  const lifetime = useRef<AbortController | null>(null)
  const adapter = useMemo(
    () =>
      transport === 'http'
        ? {
            key: httpQuery.diagnostics.slow.queryKey({ query: slowInput }),
            statusKey: httpQuery.diagnostics.operationStatus.queryKey({
              params: { operationId: slowInput.operationId },
            }),
            run: () =>
              queryClient.query(
                httpQuery.diagnostics.slow.queryOptions({ input: { query: slowInput } }),
              ),
            readStatus: () =>
              queryClient.query({
                ...httpQuery.diagnostics.operationStatus.queryOptions({
                  input: { params: { operationId: slowInput.operationId } },
                }),
                staleTime: 0,
              }),
          }
        : {
            key: rpcQuery.diagnostics.slow.queryKey(slowInput),
            statusKey: rpcQuery.diagnostics.operationStatus.queryKey({
              operationId: slowInput.operationId,
            }),
            run: () =>
              queryClient.query(rpcQuery.diagnostics.slow.queryOptions({ input: slowInput })),
            readStatus: () =>
              queryClient.query({
                ...rpcQuery.diagnostics.operationStatus.queryOptions({
                  input: { operationId: slowInput.operationId },
                }),
                staleTime: 0,
              }),
          },
    [httpQuery, queryClient, rpcQuery, slowInput, transport],
  )

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => {
      controller.abort()
      void queryClient.cancelQueries({ queryKey: adapter.key, exact: true })
      void queryClient.cancelQueries({ queryKey: adapter.statusKey, exact: true })
    }
  }, [adapter, queryClient])

  const waitForStatus = async (
    predicate: (status: DiagnosticStatus) => boolean,
    signal: AbortSignal,
  ): Promise<DiagnosticStatus> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      signal.throwIfAborted()
      const status = await adapter.readStatus()
      signal.throwIfAborted()
      if (predicate(status)) return status
      await delay(10)
    }
    throw new Error('Timed out waiting for diagnostic status')
  }

  const start = async () => {
    const signal = lifetime.current?.signal
    if (signal === undefined || signal.aborted) return
    setState({ _tag: 'Starting' })
    try {
      const before = await adapter.readStatus()
      signal.throwIfAborted()
      baseline.current = before
      void adapter.run().catch(() => undefined)
      await waitForStatus(({ started }) => started > before.started, signal)
      setState({ _tag: 'Ready' })
    } catch (error) {
      if (!signal.aborted) setState({ _tag: 'Failed', error })
    }
  }

  const cancel = async () => {
    const before = baseline.current
    const signal = lifetime.current?.signal
    if (before === undefined || signal === undefined || signal.aborted) return

    setState({ _tag: 'Cancelling' })
    try {
      // TanStack aborts the query signal; the ready client interrupts the server operation.
      await queryClient.cancelQueries({
        queryKey: adapter.key,
      })
      const status = await waitForStatus(
        ({ interrupted }) => interrupted > before.interrupted,
        signal,
      )
      setState({ _tag: 'Cancelled', interruptions: status.interrupted })
    } catch (error) {
      if (!signal.aborted) setState({ _tag: 'Failed', error })
    }
  }

  return {
    cancel,
    canCancel: state._tag === 'Ready',
    canStart: !['Cancelling', 'Ready', 'Starting'].includes(state._tag),
    start,
    state,
  } as const
}
