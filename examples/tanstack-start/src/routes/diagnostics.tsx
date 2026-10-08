import { useMutation } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { ActionButton } from '../components/action-button.tsx'
import { EffectErrorDetails } from '../components/effect-error-details.tsx'
import { PageLayout, Panel } from '../components/page-layout.tsx'
import {
  describeSlowQueryCancellation,
  useSlowQueryCancellation,
} from '../hooks/use-slow-query-cancellation.ts'

const DiagnosticsPage = () => {
  const application = Route.useRouteContext()
  const declaredFailure = useMutation(
    application.rpcQuery.diagnostics.fail.mutationOptions({
      rpcOptions: { headers: { 'x-request-source': 'diagnostics-panel' } },
    }),
  )
  const slowQuery = useSlowQueryCancellation(application)
  const cancellationMessage = describeSlowQueryCancellation(slowQuery.state)

  return (
    <PageLayout
      description="Generated operations preserve Effect causes. Cancelling the query interrupts its RPC Effect on the server."
      title="Failures and cancellation"
    >
      <div className="mt-8">
        <Panel title="Runtime diagnostics">
          <div className="mt-5 flex flex-wrap gap-3">
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
          {cancellationMessage === undefined ? null : (
            <p className="mt-4 text-sm text-text-tertiary">{cancellationMessage}</p>
          )}
        </Panel>
      </div>
    </PageLayout>
  )
}

export const Route = createFileRoute('/diagnostics')({ component: DiagnosticsPage })
