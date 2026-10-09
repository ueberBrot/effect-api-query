import { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import type { HttpApiClient } from 'effect/http-api'

export const usersApi = HttpApi.make('users').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
      error: Schema.TaggedStruct('RetryLater', {}).pipe(HttpApiSchema.status(503)),
    }),
  ),
)

export const createHttpApplicationQueries = (client: HttpApiClient.ForApi<typeof usersApi>) => {
  const http = createHttpApiQueryUtils(usersApi, { client, keyPrefix: ['users-app'] })
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false, retryDelay: 250 },
    },
  })
  queryClient.setQueryDefaults(http.key(), {
    queryKeyHashFn: (key) => `users:${JSON.stringify(key)}`,
  })
  queryClient.setQueryDefaults(http.users.key(), { retry: 1 })
  queryClient.setQueryDefaults([...http.users.get.key(), 'metadata'], { staleTime: 5_000 })

  const input = { params: { id: 1 } }
  const user = http.users.get.queryOptions({ input })
  const metadata = http.users.get.metadataOptions({ input })
  return { queryClient, http, user, metadata }
}
