import { defaultShouldDehydrateQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

export { fetchStreamSnapshot } from 'effect-api-query'

export const setupQuerySsr = (router: AnyRouter, queryClient: QueryClient): void => {
  setupRouterSsrQueryIntegration({
    dehydrateOptions: {
      // oxlint-disable-next-line anti-slop/no-unknown-parameters
      serializeData: (data: unknown) => structuredClone(data),
      shouldDehydrateQuery: defaultShouldDehydrateQuery,
    },
    queryClient,
    router,
  })
}
