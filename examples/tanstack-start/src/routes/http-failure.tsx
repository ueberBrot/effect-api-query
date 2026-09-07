import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { EffectErrorDetails } from '../components/effect-error-details.tsx'
import { PageLayout, Panel } from '../components/page-layout.tsx'

export const Route = createFileRoute('/http-failure')({
  component: HttpFailurePage,
  loader: ({ context }) =>
    context.queryClient
      .query(context.httpQuery.diagnostics.fail.queryOptions())
      .catch(() => undefined),
})

function HttpFailurePage() {
  const { httpQuery } = Route.useRouteContext()
  const failure = useQuery(httpQuery.diagnostics.fail.queryOptions())

  return (
    <PageLayout
      description="The SSR integration omits failed queries from dehydration. The browser reruns the generated query and preserves its Effect cause."
      title="Refetch failed HTTP queries"
    >
      <div className="mt-8">
        <Panel title="Declared HTTP query failure">
          {failure.isPending ? (
            <p className="mt-3 text-zinc-400">Refetching in the browser…</p>
          ) : null}
          <EffectErrorDetails error={failure.error} />
        </Panel>
      </div>
    </PageLayout>
  )
}
