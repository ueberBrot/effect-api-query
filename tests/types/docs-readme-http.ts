import { QueryClient } from '@tanstack/query-core'
import { Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import type { HttpApiClient } from 'effect/http-api'

const usersApi = HttpApi.make('users-api').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    }),
  ),
)

async function readUser(client: HttpApiClient.ForApi<typeof usersApi>, queryClient: QueryClient) {
  const http = createHttpApiQueryUtils(usersApi, { client, keyPrefix: ['users-app'] })
  const user = await queryClient.query(
    http.users.get.queryOptions({ input: { params: { id: 1 } } }),
  )
  return user.name
}

void readUser
