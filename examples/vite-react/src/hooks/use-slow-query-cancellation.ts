import type { DiagnosticStatus } from '@effect-api-query/contracts'
import { useRef, useState } from 'react'

import type { ViteReactApplication } from '../lib/application.ts'

const slowInput = {
  durationMs: 60_000,
  operationId: 'vite-react-slow-query',
} as const

// This union describes browser workflow, not data sent by Effect RPC.
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
  { queryClient, rpcQuery, httpQuery }: ViteReactApplication,
  transport: 'rpc' | 'http' = 'rpc',
) => {
  const [state, setState] = useState<SlowQueryCancellationState>({ _tag: 'Idle' })
  const baseline = useRef<DiagnosticStatus | undefined>(undefined)
  const slowKey =
    transport === 'http'
      ? httpQuery.diagnostics.slow.queryKey({ query: slowInput })
      : rpcQuery.diagnostics.slow.queryKey(slowInput)
  const runSlowQuery = () =>
    transport === 'http'
      ? queryClient.query(httpQuery.diagnostics.slow.queryOptions({ input: { query: slowInput } }))
      : queryClient.query(rpcQuery.diagnostics.slow.queryOptions({ input: slowInput }))
  const readStatus = () =>
    transport === 'http'
      ? queryClient.query({ ...httpQuery.diagnostics.status.queryOptions(), staleTime: 0 })
      : queryClient.query({ ...rpcQuery.diagnostics.status.queryOptions(), staleTime: 0 })

  const waitForStatus = async (
    predicate: (status: DiagnosticStatus) => boolean,
  ): Promise<DiagnosticStatus> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await readStatus()
      if (predicate(status)) return status
      await delay(10)
    }
    throw new Error('Timed out waiting for diagnostic status')
  }

  const start = async () => {
    setState({ _tag: 'Starting' })
    try {
      const before = await readStatus()
      baseline.current = before
      void runSlowQuery().catch(() => undefined)
      await waitForStatus(({ started }) => started > before.started)
      setState({ _tag: 'Ready' })
    } catch (error) {
      setState({ _tag: 'Failed', error })
    }
  }

  const cancel = async () => {
    const before = baseline.current
    if (before === undefined) return

    setState({ _tag: 'Cancelling' })
    try {
      // TanStack aborts the query signal; the ready client interrupts the server operation.
      await queryClient.cancelQueries({
        queryKey: slowKey,
      })
      const status = await waitForStatus(({ interrupted }) => interrupted > before.interrupted)
      setState({ _tag: 'Cancelled', interruptions: status.interrupted })
    } catch (error) {
      setState({ _tag: 'Failed', error })
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
