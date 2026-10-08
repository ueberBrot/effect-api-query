import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type { ViteReactApplication } from '../../lib/application.ts'
import { ActionButton } from '../ui/action-button.tsx'
import { EffectErrorDetails } from '../ui/effect-error-details.tsx'

const Command = ({
  application,
  number,
}: {
  readonly application: ViteReactApplication
  readonly number: number
}) => {
  // This command keeps its idempotency key for the component lifetime.
  // oxlint-disable-next-line react/hook-use-state
  const [operationId] = useState(() => globalThis.crypto.randomUUID())
  const { rpcQuery, queryClient } = application
  const input = { operationId }
  const reconcile = async () => {
    await queryClient.invalidateQueries({ queryKey: rpcQuery.commands.status.queryKey(input) })
  }
  const start = useMutation(rpcQuery.commands.start.mutationOptions({ onSettled: reconcile }))
  const cancel = useMutation(rpcQuery.commands.cancel.mutationOptions({ onSettled: reconcile }))
  const status = useQuery(
    rpcQuery.commands.status.queryOptions({
      input,
      enabled: start.status !== 'idle',
      refetchInterval: (query) =>
        query.state.data?.state === 'running' ||
        query.state.data === null ||
        query.state.data === undefined
          ? 100
          : false,
    }),
  )
  const command = status.data

  return (
    <section
      aria-label={`Command ${String(number)}`}
      className="space-y-3 border border-border-strong p-4"
    >
      <h3 className="font-semibold">Command {number}</h3>
      <div className="flex flex-wrap gap-3">
        <ActionButton
          type="button"
          disabled={start.status !== 'idle'}
          onClick={() => {
            start.mutate(input)
          }}
        >
          Start command
        </ActionButton>
        <ActionButton
          type="button"
          variant="secondary"
          disabled={
            start.status === 'idle' ||
            cancel.isPending ||
            command?.state === 'completed' ||
            command?.state === 'cancelled'
          }
          onClick={() => {
            cancel.mutate(input)
          }}
        >
          Cancel command
        </ActionButton>
      </div>
      <p>Start mutation: {start.status}</p>
      <p>Cancel mutation: {cancel.status}</p>
      <p>Server state: {command?.state ?? 'not started'}</p>
      <p>
        {command === null || command === undefined
          ? 'Progress: waiting for server'
          : `Progress: ${String(command.completedSteps)} / ${String(command.totalSteps)}`}
      </p>
      <EffectErrorDetails error={start.error ?? cancel.error ?? status.error} />
    </section>
  )
}

export const CommandsSection = ({
  application,
}: {
  readonly application: ViteReactApplication
}) => (
  <section className="space-y-4 border border-border bg-card p-6 shadow-2xl shadow-shadow/40 md:col-span-2">
    <h2 className="display-heading text-2xl font-bold text-foreground">Cancellable commands</h2>
    <p className="text-sm leading-6 text-muted-foreground">
      Start two independent commands and cancel one while it runs. Cancellation stops future steps;
      completed steps remain. Both mutations settle normally, and the status query refreshes from
      the server.
    </p>
    <div className="grid gap-4 md:grid-cols-2">
      <Command application={application} number={1} />
      <Command application={application} number={2} />
    </div>
  </section>
)
