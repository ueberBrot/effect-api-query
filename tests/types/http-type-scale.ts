import { QueryClient, type InfiniteData } from '@tanstack/query-core'
import { Schema } from 'effect'
import {
  createHttpApiQueryUtils,
  type EffectHttpApiQueryError,
  type HttpApiQueryUtils,
} from 'effect-api-query'
import type { HttpClientError } from 'effect/unstable/http'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

// Five groups retain 250 literal endpoint identifiers. The packed verifier records
// extended diagnostics for this fixture without timing or memory thresholds.
const indexes = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
] as const
const groups = ['accounts', 'organizations', 'projects', 'teams', 'users'] as const
const endpoint = <const Name extends string>(name: Name) =>
  HttpApiEndpoint.post(name, `/${name}/:id`, {
    params: { id: Schema.FiniteFromString },
    query: { cursor: Schema.FiniteFromString },
    headers: { 'x-locale': Schema.String },
    payload: Schema.Struct({ active: Schema.Boolean }),
    success: Schema.Struct({ id: Schema.FiniteFromString, name: Schema.String }),
    error: Schema.Literal('missing'),
  })
const endpoints = [
  endpoint('read.0'),
  endpoint('read.1'),
  endpoint('read.2'),
  endpoint('read.3'),
  endpoint('read.4'),
  endpoint('read.5'),
  endpoint('read.6'),
  endpoint('read.7'),
  endpoint('read.8'),
  endpoint('read.9'),
  endpoint('read.10'),
  endpoint('read.11'),
  endpoint('read.12'),
  endpoint('read.13'),
  endpoint('read.14'),
  endpoint('read.15'),
  endpoint('read.16'),
  endpoint('read.17'),
  endpoint('read.18'),
  endpoint('read.19'),
  endpoint('read.20'),
  endpoint('read.21'),
  endpoint('read.22'),
  endpoint('read.23'),
  endpoint('read.24'),
  endpoint('read.25'),
  endpoint('read.26'),
  endpoint('read.27'),
  endpoint('read.28'),
  endpoint('read.29'),
  endpoint('read.30'),
  endpoint('read.31'),
  endpoint('read.32'),
  endpoint('read.33'),
  endpoint('read.34'),
  endpoint('read.35'),
  endpoint('read.36'),
  endpoint('read.37'),
  endpoint('read.38'),
  endpoint('read.39'),
  endpoint('read.40'),
  endpoint('read.41'),
  endpoint('read.42'),
  endpoint('read.43'),
  endpoint('read.44'),
  endpoint('read.45'),
  endpoint('read.46'),
  endpoint('read.47'),
  endpoint('read.48'),
  endpoint('read.49'),
] as const
const api = HttpApi.make('type-scale').add(
  HttpApiGroup.make('accounts')
    .add(...endpoints)
    .prefix('/accounts'),
  HttpApiGroup.make('organizations')
    .add(...endpoints)
    .prefix('/organizations'),
  HttpApiGroup.make('projects')
    .add(...endpoints)
    .prefix('/projects'),
  HttpApiGroup.make('teams')
    .add(...endpoints)
    .prefix('/teams'),
  HttpApiGroup.make('users')
    .add(...endpoints)
    .prefix('/users'),
)
declare const client: HttpApiClient.ForApi<typeof api>
const keyPrefix = ['type-scale'] as const
const utils = createHttpApiQueryUtils(api, { client, keyPrefix })
const annotated: HttpApiQueryUtils<typeof api, typeof keyPrefix> = utils
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value
type Endpoint = `read.${(typeof indexes)[number]}`
true satisfies Assert<Equal<keyof typeof utils, 'key' | (typeof groups)[number]>>
true satisfies Assert<Equal<keyof typeof utils.accounts, 'key' | Endpoint>>
true satisfies Assert<Equal<keyof typeof utils.users, 'key' | Endpoint>>

const input = {
  params: { id: 1 },
  query: { cursor: 0 },
  headers: { 'x-locale': 'en' },
  payload: { active: true },
}
const queryClient = new QueryClient()
const query = utils.accounts['read.0'].queryOptions({ input, select: (user) => user.name })
const cached = queryClient.getQueryData(query.queryKey)
true satisfies Assert<
  Equal<typeof cached, { readonly id: number; readonly name: string } | undefined>
>
const mutation = utils.organizations['read.12'].mutationOptions().mutationFn(input)
true satisfies Assert<
  Equal<typeof mutation, Promise<{ readonly id: number; readonly name: string }>>
>
const endpointKey: readonly ['type-scale', 'http', 'type-scale', 'projects', 'read.24'] =
  utils.projects['read.24'].key()
const pages = utils.teams['read.36'].infiniteOptions({
  initialPageParam: 0,
  input: (cursor) => ({ ...input, query: { cursor } }),
  getNextPageParam: (_last, _pages, cursor) => cursor + 1,
})
const pageData = queryClient.getQueryData(pages.queryKey)
true satisfies Assert<
  Equal<
    typeof pageData,
    InfiniteData<{ readonly id: number; readonly name: string }, number> | undefined
  >
>
const state = queryClient.getQueryState(utils.users['read.49'].queryKey(input))
true satisfies Assert<
  Equal<
    NonNullable<typeof state>['error'],
    EffectHttpApiQueryError<'missing' | HttpClientError.HttpClientError | Schema.SchemaError> | null
  >
>
// @ts-expect-error Literal endpoint identifiers stay finite in large utility trees.
utils.accounts['read.50']
// @ts-expect-error Large trees retain decoded request types.
utils.users['read.49'].queryKey({ ...input, params: { id: '1' } })
void [annotated, endpointKey]
