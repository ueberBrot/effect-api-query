import { QueryClient } from '@tanstack/query-core'
import { createHttpApiQueryUtils } from 'effect-api-query'
import type { HttpApiClient } from 'effect/http-api'

import { usersApi } from './docs-readme-http-contract.ts'

async function readUser(client: HttpApiClient.ForApi<typeof usersApi>, queryClient: QueryClient) {
  const http = createHttpApiQueryUtils(usersApi, { client, keyPrefix: ['users-app'] })
  const user = await queryClient.query(
    http.users.get.queryOptions({ input: { params: { id: 1 } } }),
  )
  return user.name
}

void readUser
