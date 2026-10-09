import { defaultShouldDehydrateQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

export { fetchStreamSnapshot } from 'effect-api-query'

/** Configures QueryClient hydration, including Effect Schema class serialization. */
export const setupQuerySsr = (router: AnyRouter, queryClient: QueryClient): void => {
  setupRouterSsrQueryIntegration({
    dehydrateOptions: {
      // Query cache data is opaque; structuredClone preserves the serialization boundary.
      // oxlint-disable-next-line anti-slop/no-unknown-parameters
      serializeData: (data: unknown) => structuredClone(data),
      shouldDehydrateQuery: defaultShouldDehydrateQuery,
    },
    queryClient,
    router,
  })
}
