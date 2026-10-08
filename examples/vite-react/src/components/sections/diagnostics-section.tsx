import { useMutation } from '@tanstack/react-query'

import {
  describeSlowQueryCancellation,
  useSlowQueryCancellation,
} from '../../hooks/use-slow-query-cancellation.ts'
import type { ViteReactApplication } from '../../lib/application.ts'
import { ActionButton } from '../ui/action-button.tsx'
import { EffectErrorDetails } from '../ui/effect-error-details.tsx'

export const DiagnosticsSection = ({
  application,
}: {
  readonly application: ViteReactApplication
}) => {
  const declaredFailure = useMutation(
    application.rpcQuery.diagnostics.fail.mutationOptions({
      rpcOptions: { headers: { 'x-request-source': 'diagnostics-panel' } },
    }),
  )
  const slowQuery = useSlowQueryCancellation(application)
  const message = describeSlowQueryCancellation(slowQuery.state)

  return (
    <section className="space-y-4 border border-border bg-card p-6 shadow-2xl shadow-shadow/40">
      <h2 className="display-heading text-2xl font-bold text-foreground">
        Failures and cancellation
      </h2>
      <p className="text-sm leading-6 text-muted-foreground">
        Generated errors preserve their Effect causes. Cancelling the query interrupts its RPC
        Effect on the server.
      </p>
      <div className="flex flex-wrap gap-3">
        <ActionButton
          onClick={() => {
            declaredFailure.mutate()
          }}
          type="button"
          variant="danger"
        >
          Trigger declared failure
        </ActionButton>
        <ActionButton
          disabled={!slowQuery.canStart}
          onClick={() => {
            void slowQuery.start()
          }}
          type="button"
          variant="secondary"
        >
          Start slow query
        </ActionButton>
        <ActionButton
          disabled={!slowQuery.canCancel}
          onClick={() => {
            void slowQuery.cancel()
          }}
          type="button"
          variant="secondary"
        >
          Cancel query
        </ActionButton>
      </div>
      <EffectErrorDetails error={declaredFailure.error} />
      {slowQuery.state._tag === 'Failed' ? (
        <EffectErrorDetails error={slowQuery.state.error} />
      ) : null}
      {message === undefined ? null : <p className="text-sm">{message}</p>}
    </section>
  )
}
