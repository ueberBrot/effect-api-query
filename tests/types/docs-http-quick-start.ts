import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { Effect, ManagedRuntime, Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import { FetchHttpClient } from 'effect/unstable/http'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

const User = Schema.Struct({ id: Schema.Int, name: Schema.String })
const usersApi = HttpApi.make('users-api').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      query: {
        locale: Schema.String.pipe(Schema.withConstructorDefault(Effect.succeed('en'))),
      },
      success: User,
    }),
    HttpApiEndpoint.post('create', '/users', {
      payload: Schema.Struct({ name: Schema.String }),
      success: User,
    }),
  ),
)

const runtime = ManagedRuntime.make(FetchHttpClient.layer)
const queryClient = new QueryClient()

try {
  const client = await runtime.runPromise(
    HttpApiClient.make(usersApi, { baseUrl: 'http://localhost:3000' }),
  )
  const http = createHttpApiQueryUtils(usersApi, {
    client,
    keyPrefix: ['users-app'] as const,
    runPromiseExit: runtime.runPromiseExit,
  })

  const user = await queryClient.query(
    http.users.get.queryOptions({ input: { params: { id: 1 }, query: { locale: 'en' } } }),
  )
  console.log(user.name)

  const createUser = new MutationObserver(queryClient, http.users.create.mutationOptions())
  const created = await createUser.mutate({ payload: { name: 'Ada' } })
  console.log(created.id)
  await queryClient.invalidateQueries({ queryKey: http.users.key() })
} finally {
  try {
    await queryClient.cancelQueries()
  } finally {
    queryClient.clear()
    await runtime.dispose()
  }
}
