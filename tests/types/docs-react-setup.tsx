import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { ManagedRuntime, Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import type { RunPromiseExit } from 'effect-api-query'
import { FetchHttpClient } from 'effect/http'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { createRoot } from 'react-dom/client'

const usersApi = HttpApi.make('users-api').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', {
      params: { id: Schema.Int },
      success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    }),
  ),
)

const startUsersApplication = async (baseUrl: string) => {
  const runtime = ManagedRuntime.make(FetchHttpClient.layer)
  const running = new Set<Promise<unknown>>()
  const runPromiseExit: RunPromiseExit = (effect, options) => {
    const pending = runtime.runPromiseExit(effect, options)
    running.add(pending)
    void pending.then(
      () => running.delete(pending),
      () => running.delete(pending),
    )
    return pending
  }
  try {
    const client = await runtime.runPromise(HttpApiClient.make(usersApi, { baseUrl }))
    const queryClient = new QueryClient()
    const http = createHttpApiQueryUtils(usersApi, {
      client,
      keyPrefix: ['users-app'],
      runPromiseExit,
    })
    return {
      http,
      queryClient,
      dispose: async () => {
        try {
          await queryClient.cancelQueries()
        } finally {
          try {
            await Promise.allSettled([...running])
          } finally {
            queryClient.clear()
            await runtime.dispose()
          }
        }
      },
    }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}

type UsersApplication = Awaited<ReturnType<typeof startUsersApplication>>

const User = ({ application }: { readonly application: UsersApplication }) => {
  const user = useQuery(application.http.users.get.queryOptions({ input: { params: { id: 1 } } }))
  if (user.isPending) {
    return <p>Loading user…</p>
  }
  if (user.isError) {
    return <p role="alert">Could not load the user.</p>
  }
  return <h1>{user.data.name}</h1>
}

export const mountUsersApplication = async (element: HTMLElement, baseUrl: string) => {
  const application = await startUsersApplication(baseUrl)
  const root = createRoot(element)
  root.render(
    <QueryClientProvider client={application.queryClient}>
      <User application={application} />
    </QueryClientProvider>,
  )
  return async () => {
    root.unmount()
    await application.dispose()
  }
}
