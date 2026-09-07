// fallow-ignore-file unused-file
// This packed fixture verifies that every generated operation fits one TanStack Start route.
import { QueryClient } from '@tanstack/query-core'
import { useInfiniteQuery, useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { createStart } from '@tanstack/react-start'
import { Schema } from 'effect'
import { createHttpApiQueryUtils } from 'effect-api-query'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, type HttpApiClient } from 'effect/unstable/httpapi'

import type { PublicContractUtils } from './public-contract.js'

const User = Schema.Struct({ id: Schema.Int, name: Schema.String })
const httpApi = HttpApi.make('start').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('get', '/users/:id', { params: { id: Schema.Int }, success: User }),
    HttpApiEndpoint.post('create', '/users', { payload: User, success: User }),
    HttpApiEndpoint.get('page', '/users', {
      query: { cursor: Schema.Int },
      success: Schema.Struct({
        users: Schema.Array(User),
        nextCursor: Schema.NullOr(Schema.Int),
      }),
    }),
  ),
)
declare const httpClient: HttpApiClient.ForApi<typeof httpApi>
const httpQuery = createHttpApiQueryUtils(httpApi, { client: httpClient, keyPrefix: ['start'] })

interface RouterContext {
  readonly queryClient: QueryClient
  readonly rpcQuery: PublicContractUtils
  readonly httpQuery: typeof httpQuery
}

const rootRoute = createRootRouteWithContext<RouterContext>()()

const userPagesOptions = (rpcQuery: PublicContractUtils) =>
  rpcQuery.users.pages.infiniteOptions({
    getNextPageParam: (lastPage: { readonly nextCursor: number | null }) =>
      lastPage.nextCursor ?? undefined,
    initialPageParam: 0,
    input: (cursor: number) => ({ cursor }),
  })

const httpPagesOptions = (httpQuery: RouterContext['httpQuery']) =>
  httpQuery.users.page.infiniteOptions({
    initialPageParam: 0,
    input: (cursor: number) => ({ query: { cursor } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })

function StartPage() {
  const { rpcQuery, httpQuery }: RouterContext = indexRoute.useRouteContext()

  useQuery(rpcQuery.users.get.queryOptions({ input: { id: 1 } }))
  useMutation(rpcQuery.users.get.mutationOptions())
  useInfiniteQuery(userPagesOptions(rpcQuery))
  useSuspenseQuery(rpcQuery.events.audit.watch.streamedOptions())
  useSuspenseQuery(rpcQuery.projects.watch.liveOptions())
  const httpUser = useSuspenseQuery(
    httpQuery.users.get.queryOptions({ input: { params: { id: 1 } } }),
  )
  const httpMutation = useMutation(httpQuery.users.create.mutationOptions())
  const httpPages = useInfiniteQuery(httpPagesOptions(httpQuery))
  httpUser.data satisfies typeof User.Type
  httpMutation.mutate({ payload: { id: 2, name: 'Grace' } })
  httpPages.data?.pages[0]?.users satisfies ReadonlyArray<typeof User.Type> | undefined
  httpPages.data?.pageParams satisfies number[] | undefined

  return null
}

const indexRoute = createRoute({
  component: StartPage,
  getParentRoute: () => rootRoute,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.query({
        ...context.httpQuery.users.get.queryOptions({ input: { params: { id: 1 } } }),
        staleTime: 'static',
      }),
      context.queryClient.infiniteQuery({
        ...httpPagesOptions(context.httpQuery),
        staleTime: 'static',
      }),
      context.queryClient.query({
        ...context.rpcQuery.users.get.queryOptions({ input: { id: 1 } }),
        staleTime: 'static',
      }),
      context.queryClient.infiniteQuery({
        ...userPagesOptions(context.rpcQuery),
        staleTime: 'static',
      }),
      context.queryClient.query({
        ...context.rpcQuery.events.audit.watch.streamedOptions(),
        staleTime: 'static',
      }),
      context.queryClient.query({
        ...context.rpcQuery.projects.watch.liveOptions(),
        staleTime: 'static',
      }),
    ])
  },
  path: '/',
})

const routeTree = rootRoute.addChildren([indexRoute])
declare const context: RouterContext
const router = createRouter({ context, routeTree })

setupRouterSsrQueryIntegration({ queryClient: context.queryClient, router })
createStart(() => ({}))
