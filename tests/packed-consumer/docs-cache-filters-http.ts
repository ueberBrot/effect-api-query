import { Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api'

export const usersApi = HttpApi.make('users-api').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.post('get', '/users/:id', {
      params: { id: Schema.FiniteFromString },
      query: { id: Schema.FiniteFromString, filter: Schema.optional(Schema.String) },
      headers: Schema.Record(Schema.String, Schema.optional(Schema.String)),
      payload: Schema.Struct({ id: Schema.FiniteFromString }),
      success: Schema.String,
    }),
    HttpApiEndpoint.get('watch', '/users/events', {
      query: { id: Schema.FiniteFromString },
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
    }),
  ),
  HttpApiGroup.make('system', { topLevel: true }).add(
    HttpApiEndpoint.get('ping', '/health', { success: Schema.String }),
  ),
)

export const httpCacheFilters = (client: HttpApiClient.ForApi<typeof usersApi>) => {
  const http = createHttpApiQueryUtils(usersApi, { client, keyPrefix: ['users-app'] })
  const queryPrefix = [...http.users.get.key(), 'query'] as const

  return {
    http,
    root: { queryKey: http.key() },
    branch: { queryKey: http.users.key() },
    leaf: { queryKey: http.users.get.key() },
    query: { queryKey: queryPrefix },
    forId: (id: number) => ({
      queryKey: [...queryPrefix, { params: { id: String(id) } }] as const,
    }),
    forLocale: (locale: string) => ({
      queryKey: [...queryPrefix, { headers: { 'x-locale': locale } }] as const,
    }),
    historyForId: (id: number) => ({
      queryKey: [...http.users.watch.key(), 'streamed', { query: { id: String(id) } }] as const,
    }),
    exact: (input: Parameters<typeof http.users.get.queryKey>[0]) => ({
      queryKey: http.users.get.queryKey(input),
      exact: true as const,
    }),
  }
}
