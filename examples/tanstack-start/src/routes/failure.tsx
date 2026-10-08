import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { EffectErrorDetails } from '../components/effect-error-details.tsx'
import { PageLayout, Panel } from '../components/page-layout.tsx'

const FailurePage = () => {
  const { rpcQuery } = Route.useRouteContext()
  const failure = useQuery(rpcQuery.diagnostics.fail.queryOptions())

  return (
    <PageLayout
      description="The SSR integration omits failed queries from dehydration. The browser reruns the generated query and preserves its Effect cause."
      title="Refetch failed queries"
    >
      <div className="mt-8">
        <Panel title="Declared query failure">
          {failure.isPending ? (
            <p className="mt-3 text-muted-foreground">Refetching in the browser…</p>
          ) : null}
          <EffectErrorDetails error={failure.error} />
        </Panel>
      </div>
    </PageLayout>
  )
}

export const Route = createFileRoute('/failure')({
  component: FailurePage,
  loader: async ({ context }) => {
    try {
      await context.queryClient.query(context.rpcQuery.diagnostics.fail.queryOptions())
    } catch {
      // Query state retains the error for rendering.
    }
  },
})
